export function referencedRuntimeSourceEntries(sources, animations, label = 'runtime') {
  const referenced = new Set();
  for (const [animationId, animation] of Object.entries(animations)) {
    const sourceId = animation?.source;
    if (typeof sourceId !== 'string' || !sourceId) {
      throw new Error(`${label}:${animationId}: animation source is required`);
    }
    if (!Object.hasOwn(sources, sourceId)) {
      throw new Error(`${label}:${animationId}: missing animation source ${sourceId}`);
    }
    referenced.add(sourceId);
  }
  return Object.entries(sources).filter(([sourceId]) => referenced.has(sourceId));
}
