# Matching Logic (Plain-English Pseudocode)

This pseudocode defines how the Hive Mind Routing Agent ranks operators for a task using live Post Fiat data.

## Inputs

- `operators[]` from `OperatorProfile`
- `task` from `NetworkTask`
- Policy config:
  - `w_capability = 0.30`
  - `w_expertise = 0.25`
  - `w_alignment = 0.20`
  - `w_sybil = 0.15`
  - `w_activity = 0.10`
  - `min_sybil_score = 65`
  - `blocked_sybil_risk = ["High Risk"]`

## Pseudocode

1. **Parse task requirements into tags**
   - Read `task.requirements` and `task.title`.
   - Extract requirement tokens (e.g., `react`, `schema mapping`, `node telemetry`, `wallet`, `api`).
   - Store as `task_tags[]`.

2. **Filter ineligible operators**
   - For each operator:
     - If `operator.is_public != true` OR `operator.is_published != true`, mark `visibility_fail`.
     - If `operator.sybil_risk` is in `blocked_sybil_risk`, mark `sybil_fail`.
     - If `operator.sybil_score < min_sybil_score`, mark `sybil_fail`.
   - Keep only operators without hard fails for ranking.
   - Keep failed operators in output as `manual_review` candidates with gate notes.

3. **Compute capability overlap score**
   - Compare `task_tags[]` against `operator.capabilities[]`.
   - Count semantic overlaps and keyword overlaps.
   - Normalize to `capability_score` in range `[0,1]`.

4. **Compute expertise overlap score (expert tags)**
   - Compare `task_tags[]` against each `operator.expert_knowledge[].domain`.
   - Apply confidence multiplier:
     - `High -> 1.00`
     - `Medium -> 0.75`
     - `Low -> 0.50`
   - Sum weighted matches and normalize to `expertise_score` in `[0,1]`.
   - Save matched domains to `feature_snapshot.expert_domains`.

5. **Normalize trust and performance signals**
   - `alignment_score_norm = operator.alignment_score / 100`
   - `sybil_score_norm = operator.sybil_score / 100`
   - `activity_score` from recency/activity metrics:
     - Use `weekly_tasks`, `monthly_tasks`, `weekly_rewards`, `monthly_rewards`.
     - Normalize to `[0,1]` using configured caps.

6. **Compute weighted overall match**
   - `overall_match_score =`
     - `w_capability * capability_score`
     - `+ w_expertise * expertise_score`
     - `+ w_alignment * alignment_score_norm`
     - `+ w_sybil * sybil_score_norm`
     - `+ w_activity * activity_score`

7. **Compute routing confidence**
   - Start from `overall_match_score`.
   - Add small bonus if:
     - multiple high-confidence expert domains matched, and
     - operator has strong recent activity.
   - Clamp to `[0,1]` and store in `confidence`.

8. **Assign routing decision**
   - If gate failed: `routing_decision = "manual_review"`.
   - Else if `overall_match_score >= 0.75`: `routing_decision = "assign"`.
   - Else: `routing_decision = "defer"`.

9. **Build `MatchResult` records**
   - Populate:
     - `operator` (id, wallet, alignment_score, sybil_score)
     - `scores` (component scores + overall)
     - `confidence`
     - `eligibility` (gate outcomes and notes)
     - `feature_snapshot` (capabilities, matched expert domains, alignment tier, sybil risk)
     - `explanation[]` (human-readable justification)

10. **Rank output**
    - Sort all candidates for the task by `overall_match_score DESC`, tie-break by `confidence DESC`.
    - Set `rank` sequentially starting at `1`.
    - Return ranked `MatchResult[]`.

## Explicit Field Mapping

- Task-to-expertise match uses:
  - `NetworkTask.requirements`
  - `OperatorProfile.expert_knowledge[].domain`
  - `OperatorProfile.expert_knowledge[].confidence`
- Trust weighting uses:
  - `OperatorProfile.sybil_score`
  - `OperatorProfile.sybil_risk`
  - `OperatorProfile.alignment_score`
  - `OperatorProfile.alignment_tier`
- Activity weighting uses:
  - `OperatorProfile.weekly_tasks`
  - `OperatorProfile.monthly_tasks`
  - `OperatorProfile.weekly_rewards`
  - `OperatorProfile.monthly_rewards`
