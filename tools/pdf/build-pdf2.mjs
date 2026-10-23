// Builds PDF 2: SSNC_Senior_Lead_Java_Fullstack_Interview_Guide.pdf (technical reference + 142-question bank).
// Usage: node build-pdf2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PdfBuilder } from './lib/pdf-engine.mjs';
import { DOCS, FOOTER_LINES, doc, dropTitle, shiftHeadings, join, tableToCards } from './lib/common.mjs';

const OUT = path.join(DOCS, 'pdf', 'SSNC_Senior_Lead_Java_Fullstack_Interview_Guide.pdf');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const I = (f) => doc(`docs/interview/${f}`);
const L = (f) => shiftHeadings(doc(`docs/leadership/${f}`), 1);

const questionFiles = [
  ['Java and Spring Boot', 'q1-java-spring.md'],
  ['Databases', 'q2-databases.md'],
  ['Microservices, distributed systems and financial transaction integrity', 'q3-distributed-fintech.md'],
  ['Angular and REST APIs', 'q4-angular-rest.md'],
  ['Security', 'q5-security.md'],
  ['Testing, CI/CD and cloud', 'q6-testing-cicd-cloud.md'],
  ['Performance and reliability', 'q7-performance-reliability.md'],
  ['AI-assisted development and technical leadership', 'q8-ai-leadership.md'],
  ['React frontend edition', 'q9-react-frontend.md'],
];
const questionBank = join(
  'The bank has **142 questions**; 52 are marked **[Scenario]**. Every answer follows the same shape: *short answer, reasoning and implementation, alternatives and trade-offs, risks and pitfalls, likely follow-ups, and where it lives in the project*. Practise saying the short answer aloud first.',
  ...questionFiles.map(([title, f]) => `## ${title}\n\n` + shiftHeadings(dropTitle(I(f)), 0)),
);

const sections = [
  { title: 'How to use this handbook, project setup and module tour', md: dropTitle(I('00-how-to-use-and-project-tour.md')) },
  { title: 'Java, Spring Boot and Hibernate reference', md: dropTitle(I('01-java-spring-reference.md')) },
  { title: 'System design and distributed systems reference', md: dropTitle(I('02-system-design-reference.md')) },
  { title: 'Databases reference', md: dropTitle(I('03-databases-reference.md')) },
  { title: 'Angular reference', md: dropTitle(I('04-angular-reference.md')) },
  { title: 'DevOps, cloud and security reference', md: dropTitle(I('05-devops-security-reference.md')) },
  { title: 'AI-assisted development reference', md: dropTitle(I('06-ai-assisted-reference.md')) },
  {
    title: 'Technical leadership and agile delivery',
    md: join(
      'Artefacts that show ownership from requirements to production readiness: product requirements, HLD/LLD, sprint plan and risk register, review checklists, code-review scenarios, troubleshooting exercises, mentoring.',
      L('product-requirements.md'), L('hld-and-lld.md'), L('sprint-plan.md'), L('review-checklists.md'), L('code-review-scenarios.md'), L('troubleshooting-exercises.md'), L('mentoring.md'),
      shiftHeadings(doc('docs/operations/rollback-and-release.md'), 1), shiftHeadings(doc('docs/operations/post-incident-review-template.md'), 1),
    ),
  },
  { title: 'Job-description traceability matrix', md: tableToCards(dropTitle(doc('docs/jd-traceability-matrix.md')), 2) },
  { title: 'Interview question bank', md: questionBank },
];

const b = new PdfBuilder({
  outFile: OUT,
  title: 'Senior/Lead Java Full-Stack Engineer: Deep Technical Reference and Interview Guide',
  subtitle: 'Technical reference and 142-question interview bank grounded in a working financial-technology project',
  coverLines: [
    'Document: PDF 2 of 2 - Deep Technical Reference and Interview Guide',
    'Covers: Java, Spring Boot, Hibernate, system design, PostgreSQL/Oracle/MongoDB, Angular, DevOps, cloud, OAuth2/JWT/OWASP, AI-assisted development, technical leadership',
    'Synthetic data only. Educational implementation - not a production financial system.',
    'Companion: SSNC_FinTech_Platform_Architecture_and_Workflows.pdf',
  ],
  footerLines: FOOTER_LINES,
  tocLevels: 2,
  renderMermaid: () => null,
});
b.build(sections.map((s) => ({ ...s, baseDir: DOCS })));
const pages = b.doc.bufferedPageRange().count;
await b.save();
console.log(JSON.stringify({ out: OUT, pages, stats: b.stats }, null, 2));
