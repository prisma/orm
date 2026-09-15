# Upgrade instruction fragments — discussion decisions

## Refined topic

How can contributors independently record upgrade obligations, without choosing a release number or editing a shared guide, while consumers still receive one coherent, reviewed guide per audience and release transition?

The discussion began with repeated merge conflicts caused by the upgrade-instruction lint. Investigation confirmed that the current gate requires relevant PRs to change a transition's shared `instructions.md`, while the authoring skill directs contributors to append there. The issue is the contribution model, not merely Git's ability to merge adjacent text.

The operator explicitly requested this discussion, then approved capturing a spec. It was not an in-flight falsified-assumption halt. The principal-engineer lens covered merge friction, release races, validation, and operational cost; tech-lead was loaded for synthesis. There was no separate architect or other substantive persona pass.

## 1. Separate contribution from release assignment

**Decision:** Feature PRs add uniquely named, unversioned pending fragments. Release preparation assigns inputs to the transition that actually includes their code. No shared pending index is required.

**Why:** Separate files eliminate incidental contention. Deferring version assignment also eliminates fragment relocation when a release lands while a feature branch remains open. Authors know the migration their PR requires; they do not yet know its eventual release.

**Assumptions:** The fragment lands with its code, and release preparation can enumerate the candidate release tree. Unique identities do not require a shared counter. Stacked PR coverage remains relative to the actual target branch.

**Rejected:** Keeping fragments inside predicted transition directories would reduce text conflicts but preserve release-boundary churn. Continuing shared-file appends or introducing a shared fragment index would preserve the original contention point.

## 2. Publish a single synthesized guide per audience

**Decision:** An agent assembles the fragments during release preparation into one app guide and one extension guide as applicable, preserving the existing consumer format and bundled scripts. The release PR is the human-review surface.

**Why:** The operator prefers a coherent guide over making consumers traverse fragments. Synthesis can resolve redundant or interacting migrations and omit unnecessary intermediate transformations. This fits the existing release preparation workflow, which already drafts release notes.

**Assumptions:** The agent has access to original inputs and the previous/candidate code states. Existing per-PR instruction testing and human review remain the semantic checks; mechanical CI is not a semantic proof. Release-wide migration testing was subsequently excluded (decision 7). The existing app/extension split remains useful.

**Rejected:** Publishing fragments directly shifts composition work to consumers. Mechanical concatenation alone cannot reliably reconcile overlapping instructions. Reassembling a tracked guide in every feature PR recreates the shared edit problem.

**Accepted cost:** Agent synthesis is not byte-for-byte deterministic, and coherent prose requires review. Tree enumeration and basic completeness checks remain mechanical; no separate accounting ledger is required (decision 8).

## 3. Refresh releases when late fragments arrive

**Decision:** No unconsumed pending fragments may remain in a publishable release tree. If a new change joins the release after assembly, refresh the guide and its review, and archive the new originals before publication.

**Why:** Merging the release PR triggers publication of the merged tree. A guide assembled earlier can omit a feature that merged meanwhile. Allowing its fragment to wait for the next release would publish instructions later than the code they explain.

**Assumptions:** CI can validate the effective merged tree, and publication checks run before packages are published. Checking only a stale feature-branch head is insufficient.

**Rejected:** Shipping despite unconsumed inputs, or assigning those inputs to the next release while their code ships now.

**Accepted cost:** Late arrivals can delay a release and require another synthesis/review pass. The operator explicitly accepted this behavior after the race was illustrated.

## 4. Keep explicit no-op declarations

**Decision:** A relevant PR with no consumer action supplies an independent empty-change declaration. Assembly accounts for it but adds no no-op prose to the consumer guide.

**Why:** This distinguishes an assessed no-op from forgotten instructions without making unrelated PRs edit the same empty array or shared document.

**Assumptions:** Authors and reviewers still assess consumer impact; a declaration's existence alone cannot establish that the no-op judgment is correct. Different audiences can have different dispositions for the same PR.

**Rejected:** A PR label as the opt-out mechanism, or removing explicit no-op accountability. The operator chose to retain declarations.

## 5. Final-guide execution testing — superseded by decision 7

The initial discussion accepted testing the assembled guide end to end because composition can introduce mistakes. The agent then expanded this into candidate-package installation, release-wide migration rehearsal, validation receipts, and a prerequisite implementation slice.

After the operator asked whether this testing existed today, investigation clarified that the existing procedure is per-PR and agent-run, not a release-wide test system. The operator explicitly removed the new testing scope. This entry records the history only: it imposes no requirement, prerequisite, or future slice. Decision 7 is authoritative.

## 6. Archive originals in the repository, not published skills

**Decision:** Preserve consumed fragments, scripts/assets, and no-op declarations grouped by release in a repository-only archive. Consumers receive only the assembled guides and their required assets. Use the originals and release PR diff for human review; the later audit-ledger proposal was removed by decision 8.

**Why:** Readily accessible originals make synthesis review and later repairs auditable. Keeping them outside the shipped skill prevents consumer agents from discovering duplicate or superseded instructions and avoids unnecessary package content.

**Assumptions:** Packaging boundaries exclude pending inputs and archives. Archived originals are provenance, not another executable guide. A release refresh preserves originals and accounts for all inputs rather than blindly starting from the newly pending subset.

**Rejected:** Deleting sources and relying solely on Git history is leaner but less convenient for inspection. Archiving beside the guide inside published skills makes provenance too easy to mistake for instructions. The operator chose repository-only archival explicitly.

## 7. Operator scope correction: remove release-wide testing

**Trigger:** The operator questioned the validation-first slice, asked whether that testing exists today, then instructed: "Then put it out of scope!"

**Decision:** Remove release-wide migration execution testing, candidate-package installation infrastructure, validation receipts, and test-evidence freshness gates from this project. Delete the `release-guide-validation` slice rather than defer it. Retain existing per-PR instruction testing without expansion.

**Why:** The purpose is to stop upgrade-instruction conflicts. A new release-testing system is not necessary for independent fragments, synthesis, archival, or completeness enforcement. The agent's plan expanded the work beyond that purpose.

**Retained safeguards at this correction:** Human review, mechanical checks, late-arrival blocking, ordinary regression tests, and existing packaging checks. Decision 8 further narrows the mechanical checks and removes the audit ledger.

**Accepted trade-off:** The project does not establish release-wide migration correctness by execution. CI must not represent accounting checks as that proof. A separate testing initiative would require separate authorization, not become a hidden dependency here.

**Affected artifacts:** `spec.md`, `plan.md`, and `implementation-contracts.md` are narrowed together. The plan now contains one coordinated fragment-lifecycle slice with no new testing prerequisite.

## 8. Operator scope correction: remove nonessential machinery and ceremony

**Trigger:** The operator asked what else was unnecessary for the original merge-conflict problem, reviewed the list, and instructed: "remove everything you suggested to remove".

**Decision:** Remove the digest-based assembly ledger and disposition mappings, first-parent history scanning for deleted fragments, custom preparation/finalization commands and staging protocol, historical ID reservation and mandatory random suffixes. Narrow linting to readable declarations, audience coverage, and usable script references rather than broader metadata/prose validation. Remove additional Linear Project setup, slice-spec deliverables, mandatory ADR, and formal project close-out as prerequisites introduced by the plan.

**Why:** These additions addressed auditing, defensive enforcement, and process organization, not the shared-file conflict. The existing release skill can gather fragments, synthesize guides, and move originals without a new orchestration tool or audit subsystem.

**Retained:** Unversioned independent fragments, explicit no-ops, a single reviewed guide per audience, repository-only archives, late-arrival release blocking, existing per-PR instruction testing, essential mechanism regression tests, and updated instructions.

**Accepted trade-off:** An empty pending tree is not proof that no file was deleted or that every archived instruction was incorporated. The release PR diff and original fragments support human review of those cases. No hidden future audit or testing slice is required.

**Affected artifacts:** `spec.md`, `plan.md`, and `implementation-contracts.md` now describe the minimal workflow. Earlier references to machine-checkable accounting or project ceremony are superseded. Normal repository rules still apply when implementation begins; the plan does not introduce extra ceremony.

## Accepted boundaries and remaining delivery work

The agreed change does not replace the substrate heuristic, rewrite historical releases, or automate human release approval. Existing unreleased guidance must survive the layout change.

[The spec](./spec.md) and [plan](./plan.md) describe the reduced scope. This decision history preserves why the scope changed; it is not a requirement to create another ADR, tracker project, or planning document.

## Spec-authoring note

The canonical Drive `spec-authored` emitter was invoked after writing the spec but could not resolve its `arktype` dependency from the installed skill directory. No trace event was emitted; no dependency or harness configuration was changed to work around that documentation-tooling failure.
