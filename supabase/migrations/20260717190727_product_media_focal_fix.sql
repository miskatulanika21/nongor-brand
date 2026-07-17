-- Reconciliation marker (Focal Studio Phase 2).
--
-- On production this version corrected the set_product_media body first applied
-- in 20260717190529 (an in-session reconstruction had drifted from the original
-- contract — wrong revision-conflict code, an extra role gate, a dropped
-- alt-length check). The repo folds the corrected function into 20260717190529
-- itself, so a fresh replay already lands the faithful function and this file is
-- an intentional no-op that only keeps the repo's migration versions aligned
-- with production history.
SELECT 1;
