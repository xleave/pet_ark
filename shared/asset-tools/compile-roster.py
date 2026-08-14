#!/usr/bin/env python3
"""Compile the checked-in operator registry from public index data and temporary portraits.

Portraits are analysis inputs only: the compiler extracts a small palette and silhouette
measurements, and never copies source pixels into generated pets or the repository.
"""
from __future__ import annotations

import argparse
import colorsys
import json
import re
import unicodedata
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image


class OperatorIndexParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.in_filter = False
        self.items: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or '' for key, value in attrs}
        if tag == 'div' and values.get('id') == 'filter-data':
            self.in_filter = True
            self.depth = 1
            return
        if self.in_filter:
            if tag == 'div':
                self.depth += 1
                if self.depth == 2 and values.get('data-id'):
                    self.items.append({key[5:]: value for key, value in values.items() if key.startswith('data-')})

    def handle_endtag(self, tag: str) -> None:
        if self.in_filter and tag == 'div':
            self.depth -= 1
            if self.depth == 0:
                self.in_filter = False


def slugify(name: str, game_key: str) -> str:
    normalized = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    normalized = re.sub(r"[^a-z0-9]+", '-', normalized).strip('-')
    if not normalized:
        normalized = game_key.removeprefix('char_').replace('_', '-')
    return normalized


def is_skin(rgb: tuple[int, int, int]) -> bool:
    red, green, blue = rgb
    return red > 125 and red >= green * 1.03 and green >= blue * .82 and red - blue > 18


def hex_color(rgb: tuple[int, int, int]) -> str:
    return '#%02x%02x%02x' % rgb


def mix(rgb: tuple[int, int, int], target: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(value * (1 - amount) + goal * amount) for value, goal in zip(rgb, target))


def color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return sum((a - b) ** 2 for a, b in zip(left, right)) ** .5


def dominant(image: Image.Image, box: tuple[int, int, int, int], *, skip_skin: bool = False) -> list[tuple[int, int, int]]:
    crop = image.crop(box).convert('RGBA').resize((64, 64))
    pixels = []
    for red, green, blue, alpha in crop.getdata():
        if alpha < 100 or max(red, green, blue) < 18:
            continue
        rgb = (red, green, blue)
        if skip_skin and is_skin(rgb):
            continue
        pixels.append(rgb)
    if not pixels:
        return [(70, 70, 78)]
    sample = Image.new('RGB', (len(pixels), 1))
    sample.putdata(pixels)
    quantized = sample.quantize(colors=12, method=Image.Quantize.MEDIANCUT).convert('RGB')
    counts = Counter(quantized.getdata())
    return [color for color, _ in counts.most_common()]


def pick_distinct(colors: list[tuple[int, int, int]], first: tuple[int, int, int]) -> tuple[int, int, int]:
    candidates = [color for color in colors if color_distance(color, first) > 55]
    return candidates[0] if candidates else mix(first, (245, 245, 245), .38)


def pick_accent(colors: list[tuple[int, int, int]], fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    ranked = sorted(colors, key=lambda rgb: colorsys.rgb_to_hsv(*(value / 255 for value in rgb))[1], reverse=True)
    for color in ranked:
        saturation = colorsys.rgb_to_hsv(*(value / 255 for value in color))[1]
        if saturation > .28 and color_distance(color, fallback) > 35:
            return color
    return mix(fallback, (217, 147, 67), .45)


RACE_FEATURES = {
    '卡特斯': ('rabbit', 'none', 'none', 'none', 'none'),
    '菲林': ('cat', 'none', 'none', 'thin', 'none'),
    '鲁珀': ('wolf', 'none', 'none', 'fluffy', 'none'),
    '沃尔珀': ('fox', 'none', 'none', 'fluffy', 'none'),
    '乌萨斯': ('bear', 'none', 'none', 'thin', 'none'),
    '萨科塔': ('none', 'none', 'ring', 'none', 'none'),
    '萨卡兹': ('none', 'curved', 'none', 'none', 'none'),
    '鬼': ('none', 'curved', 'none', 'none', 'none'),
    '埃拉菲亚': ('deer', 'branch', 'none', 'thin', 'none'),
    '卡普里尼': ('none', 'ram', 'none', 'thin', 'none'),
    '库兰塔': ('deer', 'none', 'none', 'thin', 'none'),
    '黎博利': ('none', 'none', 'none', 'none', 'feather'),
    '德拉克': ('none', 'curved', 'none', 'thin', 'none'),
    '瓦伊凡': ('none', 'curved', 'none', 'thin', 'none'),
    '龙': ('none', 'curved', 'none', 'thin', 'none'),
    '丰蹄': ('deer', 'none', 'none', 'thin', 'none'),
}

PROFESSION_MAP = {
    '先锋': 'vanguard', '近卫': 'guard', '重装': 'defender', '狙击': 'sniper',
    '术师': 'caster', '医疗': 'medic', '辅助': 'supporter', '特种': 'specialist',
}


def weapon_for(profession: str, subclass: str, code: int) -> tuple[str, str]:
    if profession == 'defender': return ('gun', 'fortress cannon') if '要塞' in subclass else ('shield', 'signature shield')
    if profession == 'guard':
        if '重剑' in subclass or '撼地' in subclass: return 'hammer', 'heavy breaker'
        if '教官' in subclass or '领主' in subclass: return 'spear', 'polearm'
        return 'sword', 'blade'
    if profession == 'sniper': return ('bow', 'longbow') if any(word in subclass for word in ('猎手', '攻城')) else ('gun', 'ranged weapon')
    if profession == 'caster': return 'staff', 'arts staff'
    if profession == 'medic': return 'medical', 'medical device'
    if profession == 'supporter': return ('instrument', 'instrument') if code % 4 == 0 else ('book', 'arts device')
    if profession == 'specialist': return ('drone', 'technical device') if code % 3 == 0 else ('sword', 'specialist tool')
    if profession == 'vanguard': return ('sword', 'tactical blade') if code % 3 == 0 else ('spear', 'vanguard polearm')
    return 'other', 'personal equipment'


CURATED: dict[str, dict] = {
    '阿米娅': {'hair_shape': 'long', 'hair': '#40362f', 'ears': 'rabbit', 'outfit': 'coat', 'accent': '#2ac7c9', 'weapon': 'book', 'headgear': 'ornament'},
    '能天使': {'hair_shape': 'bob', 'hair': '#d05d51', 'halo': 'ring', 'outfit': 'uniform', 'accent': '#f0b94c', 'weapon': 'gun'},
    '陈': {'hair_shape': 'long', 'hair': '#273f58', 'horns': 'curved', 'outfit': 'uniform', 'accent': '#cc3945', 'weapon': 'sword'},
    '德克萨斯': {'hair_shape': 'twin-tails', 'hair': '#343b47', 'ears': 'wolf', 'tail': 'fluffy', 'outfit': 'uniform', 'accent': '#5fc5d4', 'weapon': 'sword'},
    '拉普兰德': {'hair_shape': 'long', 'hair': '#e5e6e0', 'ears': 'wolf', 'tail': 'fluffy', 'outfit': 'coat', 'accent': '#c83743', 'weapon': 'sword'},
    '银灰': {'hair_shape': 'short', 'hair': '#e8e9e4', 'ears': 'cat', 'tail': 'fluffy', 'outfit': 'coat', 'accent': '#6ab1c0', 'weapon': 'sword', 'companion': 'beast'},
    '凯尔希': {'hair_shape': 'long', 'hair': '#607d67', 'ears': 'cat', 'outfit': 'coat', 'accent': '#4bcbb6', 'weapon': 'medical', 'companion': 'beast'},
    '斯卡蒂': {'hair_shape': 'long', 'hair': '#e5e2dd', 'outfit': 'dress', 'accent': '#c82f42', 'weapon': 'sword'},
    '浊心斯卡蒂': {'hair_shape': 'long', 'hair': '#f0ebe3', 'outfit': 'dress', 'accent': '#b82842', 'weapon': 'instrument'},
    '史尔特尔': {'hair_shape': 'long', 'hair': '#bd323a', 'horns': 'curved', 'outfit': 'dress', 'accent': '#e7a33e', 'weapon': 'sword'},
    '艾雅法拉': {'hair_shape': 'long', 'hair': '#ae765c', 'horns': 'ram', 'outfit': 'coat', 'accent': '#dc8152', 'weapon': 'staff'},
    '塞雷娅': {'hair_shape': 'short', 'hair': '#e6e4dc', 'horns': 'curved', 'outfit': 'armor', 'accent': '#e58637', 'weapon': 'shield'},
    '泥岩': {'hair_shape': 'long', 'hair': '#d9d8d1', 'horns': 'curved', 'outfit': 'armor', 'accent': '#cf6938', 'weapon': 'hammer', 'headgear': 'mask'},
    'W': {'hair_shape': 'twin-tails', 'hair': '#e7e6df', 'horns': 'curved', 'outfit': 'uniform', 'accent': '#bd2b3f', 'weapon': 'gun'},
    '维什戴尔': {'hair_shape': 'long', 'hair': '#dedbd3', 'horns': 'curved', 'outfit': 'coat', 'accent': '#c72c43', 'weapon': 'gun'},
    '迷迭香': {'hair_shape': 'long', 'hair': '#dad5cb', 'ears': 'cat', 'outfit': 'dress', 'accent': '#4ec3c0', 'weapon': 'drone', 'companion': 'device'},
    '莫斯提马': {'hair_shape': 'long', 'hair': '#4b78a2', 'horns': 'curved', 'halo': 'fragmented', 'outfit': 'coat', 'accent': '#48b7d1', 'weapon': 'staff'},
    '年': {'hair_shape': 'long', 'hair': '#e9e6df', 'horns': 'curved', 'outfit': 'dress', 'accent': '#d84a35', 'weapon': 'shield'},
    '夕': {'hair_shape': 'long', 'hair': '#b8bed1', 'horns': 'curved', 'outfit': 'robe', 'accent': '#476ea9', 'weapon': 'book'},
    '令': {'hair_shape': 'long', 'hair': '#202b3e', 'horns': 'curved', 'outfit': 'robe', 'accent': '#d0a147', 'weapon': 'staff'},
    '黍': {'hair_shape': 'long', 'hair': '#e7e1cb', 'horns': 'curved', 'outfit': 'robe', 'accent': '#7ead5e', 'weapon': 'shield'},
    '煌': {'hair_shape': 'ponytail', 'hair': '#403a3c', 'ears': 'cat', 'outfit': 'uniform', 'accent': '#d45536', 'weapon': 'other'},
    '临光': {'hair_shape': 'long', 'hair': '#e9dfc1', 'ears': 'deer', 'tail': 'thin', 'outfit': 'armor', 'accent': '#d6a935', 'weapon': 'shield'},
    '玛恩纳': {'hair_shape': 'short', 'hair': '#dfd2ad', 'ears': 'deer', 'tail': 'thin', 'outfit': 'coat', 'accent': '#d2a139', 'weapon': 'sword'},
    '幽灵鲨': {'hair_shape': 'long', 'hair': '#e7e3db', 'outfit': 'dress', 'accent': '#b92c43', 'weapon': 'other', 'headgear': 'hat'},
    '棘刺': {'hair_shape': 'short', 'hair': '#292b31', 'outfit': 'coat', 'accent': '#d9b442', 'weapon': 'sword'},
    '山': {'hair_shape': 'short', 'hair': '#e8e5dc', 'ears': 'cat', 'tail': 'fluffy', 'outfit': 'uniform', 'accent': '#de6d39', 'weapon': 'none'},
    '星熊': {'hair_shape': 'long', 'hair': '#263134', 'horns': 'curved', 'outfit': 'armor', 'accent': '#55a38e', 'weapon': 'shield'},
    '伊芙利特': {'hair_shape': 'long', 'hair': '#d5d3c9', 'horns': 'curved', 'outfit': 'coat', 'accent': '#d86c34', 'weapon': 'gun'},
    '安洁莉娜': {'hair_shape': 'long', 'hair': '#b98667', 'ears': 'fox', 'tail': 'fluffy', 'outfit': 'dress', 'accent': '#e7a45d', 'weapon': 'staff'},
    '刻俄柏': {'hair_shape': 'long', 'hair': '#d1a96e', 'ears': 'fox', 'tail': 'fluffy', 'outfit': 'uniform', 'accent': '#d55434', 'weapon': 'spear'},
    '逻各斯': {'hair_shape': 'long', 'hair': '#22242c', 'horns': 'curved', 'outfit': 'robe', 'accent': '#61459b', 'weapon': 'book'},
    '特蕾西娅': {'hair_shape': 'long', 'hair': '#dbc5cf', 'horns': 'curved', 'outfit': 'robe', 'accent': '#a75ca2', 'weapon': 'staff'},
}


def build_entry(raw: dict[str, str], game_key: str, image_path: Path) -> dict:
    image = Image.open(image_path).convert('RGBA')
    code = sum((index + 3) * ord(char) for index, char in enumerate(raw['id']))
    hair_colors = dominant(image, (22, 4, 158, 112), skip_skin=True)
    outfit_colors = dominant(image, (20, 95, 160, 180), skip_skin=True)
    hair_rgb = hair_colors[0]
    primary_rgb = outfit_colors[0]
    secondary_rgb = pick_distinct(outfit_colors[1:] + hair_colors, primary_rgb)
    accent_rgb = pick_accent(outfit_colors + hair_colors, primary_rgb)
    skin_candidates = [color for color in dominant(image, (45, 35, 140, 115)) if is_skin(color)]
    skin_rgb = skin_candidates[0] if skin_candidates else (239, 205, 194)

    profession = PROFESSION_MAP[raw['profession']]
    race = raw.get('race', '')
    ears, horns, halo, tail, wings = RACE_FEATURES.get(race, ('none', 'none', 'none', 'none', 'none'))
    body_kind = 'robot' if raw.get('rarity') == '0' and not race else 'human'
    alpha = image.getchannel('A')
    bbox = alpha.getbbox() or (25, 5, 155, 178)
    lower_width = sum(1 for x in range(180) if any(alpha.getpixel((x, y)) > 80 for y in range(115, 170)))
    asym_left = sum(1 for x in range(15, 88) for y in range(70, 158) if alpha.getpixel((x, y)) > 100)
    asym_right = sum(1 for x in range(92, 165) for y in range(70, 158) if alpha.getpixel((x, y)) > 100)
    if max(asym_left, asym_right) > max(1, min(asym_left, asym_right)) * 1.28:
        hair_shape = 'ponytail'
    elif code % 11 == 0:
        hair_shape = 'twin-tails'
    elif code % 13 == 0:
        hair_shape = 'braid'
    else:
        hair_shape = 'long' if bbox[3] > 165 or code % 3 == 0 else 'short'
    length = 62 if hair_shape in ('long', 'twin-tails', 'ponytail', 'braid') else 30 + code % 12

    outfit_type = {
        'defender': 'armor', 'caster': 'robe', 'medic': 'coat', 'supporter': 'dress',
        'vanguard': 'uniform', 'guard': 'uniform', 'sniper': 'coat', 'specialist': 'uniform',
    }[profession]
    weapon_type, weapon_label = weapon_for(profession, raw.get('subprofession', ''), code)
    headgear = ('hat', 'ornament', 'goggles', 'ornament', 'glasses', 'ornament', 'mask', 'ornament', 'eyepatch', 'ornament')[code % 10]
    companion = 'drone' if '工匠' in raw.get('subprofession', '') else 'beast' if any(word in raw.get('subprofession', '') for word in ('召唤', '战术家')) else 'none'
    override = CURATED.get(raw['zh'], {})
    hair_shape = override.get('hair_shape', hair_shape)
    hair_rgb = tuple(bytes.fromhex(override['hair'][1:])) if 'hair' in override else hair_rgb
    ears = override.get('ears', ears)
    horns = override.get('horns', horns)
    halo = override.get('halo', halo)
    tail = override.get('tail', tail)
    wings = override.get('wings', wings)
    outfit_type = override.get('outfit', outfit_type)
    accent_rgb = tuple(bytes.fromhex(override['accent'][1:])) if 'accent' in override else accent_rgb
    weapon_type = override.get('weapon', weapon_type)
    headgear = override.get('headgear', headgear)
    companion = override.get('companion', companion)
    if body_kind == 'robot':
        outfit_type, hair_shape, headgear = 'mechanical', 'short', 'ornament'
        ears = horns = halo = tail = wings = 'none'

    source_name = raw.get('en') or raw['zh']
    shape_label = {'long': 'long layered', 'short': 'compact cropped', 'ponytail': 'asymmetric ponytail', 'twin-tails': 'paired twin-tail', 'braid': 'side braid'}.get(hair_shape, hair_shape)
    species_label = next((label for label, value in [('animal ears', ears), ('horns', horns), ('halo', halo), ('tail', tail), ('wings', wings)] if value != 'none'), race or 'human silhouette')
    accessory_label = {'ornament': 'one-sided hair ornament', 'hat': 'distinctive hat', 'goggles': 'head-mounted goggles', 'glasses': 'glasses', 'mask': 'face mask', 'eyepatch': 'single eyepatch'}.get(headgear, headgear)
    signature = [
        f'{shape_label} {hex_color(hair_rgb)} hair silhouette',
        f'{outfit_type} outfit with {hex_color(primary_rgb)} and {hex_color(secondary_rgb)} blocks',
        f'{species_label}: {race or "mechanical unit"}',
        f'{weapon_label}: {weapon_type}',
        accessory_label,
        f'asymmetric profile {bbox[0]}:{bbox[2]} with accent {hex_color(accent_rgb)}',
    ]
    motif = {'medic': 'cross', 'defender': 'diamond', 'sniper': 'stripe', 'caster': 'ring'}.get(profession, 'crest')
    effect = 'arts' if profession in ('caster', 'supporter') or halo != 'none' else 'none'
    direction_fixed = headgear in ('eyepatch',) or (code % 17 == 0)
    side = 'left' if asym_left > asym_right else 'right'
    line_rgb = mix(hair_rgb if sum(hair_rgb) < 600 else primary_rgb, (18, 19, 24), .62)
    metal_rgb = mix(secondary_rgb, (185, 190, 197), .55)
    return {
        'id': '',
        'display_name': source_name,
        'localized_name': raw['zh'],
        'source_name': source_name,
        'source_id': raw['id'],
        'game_key': game_key,
        'status': 'implemented',
        'renderer': 'generic-vector-v1',
        'profession': profession,
        'subprofession': raw.get('subprofession', ''),
        'rarity': int(raw['rarity']) + 1,
        'race': race,
        'visual_signature': signature,
        'identifying_features': {'motif': motif, 'effect': effect, 'summary': '; '.join(signature[:5])},
        'hair': {'shape': hair_shape, 'color': hex_color(hair_rgb), 'length': length, 'fringe_count': 3 + code % 5},
        'face': {'width': 32 + code % 4, 'height': 29 + (code // 3) % 4, 'eye_gap': 17 + (code % 4) * .5, 'eye_width': 4.8 + (code % 5) * .35, 'eye_height': 5.7 + (code % 4) * .4, 'marking': ('none', 'none', 'none', 'freckles', 'scar', 'tattoo')[code % 6]},
        'outfit': {'type': outfit_type, 'sleeve_style': ('regular', 'wide', 'regular', 'bare')[code % 4], 'boot_style': ('flat', 'tall', 'heeled')[code % 3], 'signature': signature[1]},
        'palette': {
            'primary': hex_color(primary_rgb), 'secondary': hex_color(secondary_rgb), 'accent': hex_color(accent_rgb),
            'hair': hex_color(hair_rgb), 'hair_highlight': hex_color(mix(hair_rgb, (255, 255, 255), .28)),
            'eye': hex_color(pick_accent(hair_colors + outfit_colors, accent_rgb)), 'line': hex_color(line_rgb),
            'mouth': '#804d5b', 'skin': hex_color(skin_rgb), 'skin_line': hex_color(mix(skin_rgb, (78, 47, 50), .46)),
            'boot': hex_color(mix(primary_rgb, (25, 25, 31), .58)), 'leg': hex_color(mix(secondary_rgb, (31, 31, 39), .54)),
            'metal': hex_color(metal_rgb), 'horn': hex_color(mix(hair_rgb, (205, 188, 170), .45)),
            'halo': hex_color(mix(accent_rgb, (255, 220, 96), .45)), 'weapon': hex_color(mix(primary_rgb, (55, 59, 66), .35)),
        },
        'species_features': {'body_kind': body_kind, 'ears': ears, 'horns': horns, 'halo': halo, 'tail': tail, 'wings': wings},
        'weapon': {'type': weapon_type, 'label': weapon_label, 'side': side, 'angle': -12 + code % 25, 'direction_fixed': False},
        'accessories': {'headgear': headgear, 'side': side, 'companion': companion, 'direction_fixed': direction_fixed},
        'dynamics': {'hair_weight': round(.65 + (length / 70) * .65, 2), 'coat_weight': round(.7 + (lower_width % 45) / 60, 2), 'tail_weight': 1 if tail != 'none' else 0},
        'directional': {'strategy': 'fixed-detail-overlay' if direction_fixed else 'safe-mirror', 'fixed_elements': [accessory_label] if direction_fixed else []},
        'geometry': {
            'hair_volume': 31 + (bbox[2] - bbox[0]) % 10, 'top_height': max(0, min(8, 7 - bbox[1] // 4)),
            'side_lock': 2 + code % 9, 'highlight_width': code % 4, 'body_width': 43 + lower_width % 12,
            'coat_width': 3 + (lower_width // 3) % 13, 'leg_spacing': code % 5, 'ornament_code': code % 16,
            'signature_code': code % 29,
        },
        'source_refs': ['official-operator-archive', 'prts-playable-operator-index', 'arknights-game-data'],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--index-html', type=Path, required=True)
    parser.add_argument('--character-table', type=Path, required=True)
    parser.add_argument('--portraits', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()

    html_parser = OperatorIndexParser()
    html_parser.feed(args.index_html.read_text(encoding='utf8'))
    unique: dict[str, dict[str, str]] = {}
    for item in html_parser.items:
        unique.setdefault(item['id'], item)

    game_data = json.loads(args.character_table.read_text(encoding='utf8'))
    by_number = {value.get('displayNumber'): (key, value) for key, value in game_data.items() if value.get('displayNumber')}
    entries = []
    used_ids: set[str] = set()
    missing = []
    for raw in unique.values():
        game = by_number.get(raw['id'])
        if not game:
            missing.append(raw['id'])
            continue
        game_key, _ = game
        portrait = args.portraits / f'{game_key}.png'
        if not portrait.exists():
            missing.append(f'{raw["id"]}:portrait')
            continue
        entry = build_entry(raw, game_key, portrait)
        base = slugify(entry['source_name'], game_key)
        candidate = f'{base}-chibi'
        if candidate in used_ids:
            candidate = f'{base}-{raw["id"].lower()}-chibi'
        entry['id'] = candidate
        used_ids.add(candidate)
        entries.append(entry)
    if missing:
        raise SystemExit(f'Missing source mappings: {missing}')
    entries.sort(key=lambda entry: (entry['profession'], entry['source_id']))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'compiled {len(entries)} playable operator definitions')


if __name__ == '__main__':
    main()
