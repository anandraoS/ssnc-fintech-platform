# Documentation index

| Folder | Contents |
|---|---|
| `architecture/` | business objectives, requirements, system context, components, lifecycles, integrity and concurrency, API design, database, security architecture, observability, CI/CD and deployment, Angular frontend, React frontend edition, backend |
| `decisions/` | 13 Architecture Decision Records (ADR-001 ... ADR-013) |
| `security/` | threat model, OWASP mapping |
| `testing/` | test strategy, TDD example (real red/green output), BDD scenarios |
| `operations/` | runbooks (one section per alert), performance troubleshooting, SLOs, secrets management, release and rollback, post-incident template, troubleshooting scenarios |
| `leadership/` | product requirements, HLD/LLD, sprint plan and risk register, review checklists, code-review scenarios, troubleshooting exercises, mentoring |
| `interview/` | handbook chapters and the 142-question bank (source of the second PDF) |
| `diagrams/` | 17 Mermaid sources (`*.mmd`) and rendered PNGs |
| `api/` | real request/response examples captured from the running application |
| `database/` | captured PostgreSQL query plans |
| `validation/` | validation report and raw results of executed runs (API e2e, UI e2e, performance baselines) |
| `screenshots/`, `screenshots-react/` | screenshots produced by the browser end-to-end run (Angular UI, React UI) |
| `pdf/` | the two generated PDFs |
| `jd-traceability-matrix.md` | job requirement -> evidence mapping |
| `limitations-and-future.md` | what was not executed, known gaps, next steps |

Sources of truth: code and tests first, then ADRs, then these documents. Every PDF chapter is generated from these files (`tools/pdf`).
