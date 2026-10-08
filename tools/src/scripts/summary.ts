import { buildSummaryReport } from '../utils/build-summary-report';

// Turns the summary export of k6 into markdown for the job summary of the workflow.
//   node summary.js [k6-summary.json] [server.log] [title]

const [summaryPath = 'k6-summary.json', serverLogPath, title] = process.argv.slice(2);

console.log(buildSummaryReport(summaryPath, serverLogPath, title));
