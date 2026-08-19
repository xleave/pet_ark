# Standalone asset storage policy

The standalone source, deterministic exports, accepted generated motion, runtime atlases, and contact sheets are intentionally committed as ordinary Git objects in this repository. This keeps a checkout reproducible and reviewable without depending on an expiring CI artifact or on Git LFS ownership and quota being transferred from an external-maintainer fork to the upstream repository.

This is a deliberate policy for the current 425-character / 933-variant release, not an accidental consequence of the build pipeline. It carries a real clone and fetch cost, so the repository enforces these limits in pull-request CI:

- at most **8 GiB** for the complete uncompressed tracked working tree;
- at most **4 GiB** for Git object storage in the fresh, shallow CI checkout, after Git's ordinary object reuse and compression;
- at most **50 MiB** for any individual tracked file;
- generated tiers may exist only when they serve a distinct audit or runtime purpose; new duplicate output tiers require maintainer review;
- crossing any budget requires a separate storage migration decision before merge, such as an upstream-owned Git LFS allocation or durable release storage.

`npm run repository:asset-budget` checks all three numeric limits. It sums ordinary file sizes for the working-tree and per-file limits, and reads `git count-objects -v` for the repository object-store limit. It intentionally does not add hashes or digests. The file-size check requires a complete checkout so a sparse clone cannot undercount assets; CI uses a fresh depth-one checkout so unrelated local history cannot inflate the object-store measurement.

The current choice avoids a subtle failure mode in cross-fork pull requests: LFS pointers can be merged while their backing objects remain billed to, or only accessible through, the contributor's fork. If upstream later provisions and owns LFS storage, the migration should rewrite the relevant asset history in a dedicated maintenance change and update CI checkout behavior at the same time.
