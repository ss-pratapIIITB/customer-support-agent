# Verified local demo walkthrough

Verified on 8 October 2026, Asia/Singapore: portal health is ready on port 3000; native PostgreSQL runs on 5433; LiteLLM runs on 4000. Active corpus `3bb1d3d61bfe22e0b4bfcc3251aae3e715ec00de982069d6705a63950ffe9944` contains 8 products, 11 sources, and 102 chunks. Five product additions activated in 3.697 seconds. All five RAG integration tests and typecheck passed. Check current dashboard status for quality and failure results; this document does not certify a still-running quality evaluation.

1. Open http://127.0.0.1:3000 and log in as `customer@maxify.demo`, password `Demo123!`.
2. Ask **What is iPhone 17 battery life?** Inspect the source: up to 30 hours video playback and 27 hours streamed video, with manufacturer qualifiers.
3. Ask **What is MacBook Air battery life?** Inspect the cited official specification, up to 18 hours video streaming and 15 hours wireless web. Ask a follow-up such as **How much memory does it support?** and inspect its product scope.
4. Ask **Can I return it?** Confirm the evidence explicitly says **Demo store policy**, rather than presenting retailer procedures as Apple's terms.
5. Ask **What is my order status?** Observe an evidence gap without invented account data.
6. Refresh the page and reopen the conversation to show persisted history. For a repeatable process-interruption demonstration, use `npx tsx scripts/failure-checks.ts`; it restarts an isolated app on 3001 and records its evidence.
7. Log out and log in as `reviewer@maxify.demo`, same password. Inspect sources, saved evaluation status, failure records, a real trace, model use, skills, usage/cost records, and unknown-cost indicators.

The five new official sources are:

- https://www.apple.com/iphone-17/specs/
- https://www.apple.com/ipad-air/specs/
- https://www.apple.com/ipad-pro/specs/
- https://www.apple.com/macbook-air/specs/
- https://www.apple.com/macbook-pro/specs/

Use `npm run ingest` to show an unchanged active rerun with zero embedding calls. Use `RAG_INTEGRATION=1 npx tsx --test tests/rag.test.ts` for the verified retrieval and ingestion safety checks. The original 24-case quality dataset remains frozen; the five additions have live retrieval checks and have not acquired a separate human-audited quality score.

For restart/startup commands, the alternative Colima/Compose workflow, and port differences, follow README.md. Hosting remains future work.
