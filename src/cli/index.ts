#!/usr/bin/env node

import { Command } from 'commander';
import { collectCommand } from './collect.js';
import { serveCommand } from './serve.js';
import { reportCommand } from './report.js';

const program = new Command();

program
  .name('ds-observatory')
  .description('Design system observability — Figma component usage analytics')
  .version('0.1.0');

program
  .command('collect')
  .description('Run Figma collectors and write data to local store')
  .option('--token <token>', 'Figma access token (overrides FIGMA_ACCESS_TOKEN)')
  .option('--team <teamId>', 'Figma team ID (overrides FIGMA_TEAM_ID)')
  .option('--hot-files <count>', 'Number of hot files to analyze', '15')
  .option('--window <days>', 'Hot file window in days', '60')
  .action(collectCommand);

program
  .command('serve')
  .description('Start the dashboard on localhost')
  .option('-p, --port <port>', 'Port number', '3333')
  .action(serveCommand);

program
  .command('report')
  .description('Generate a self-contained HTML report')
  .option('-o, --output <path>', 'Output file path', 'ds-observatory-report.html')
  .action(reportCommand);

program.parse();
