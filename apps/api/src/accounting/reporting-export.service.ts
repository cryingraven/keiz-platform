import { Injectable } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportExportQuery } from '@keiz/shared';
import { FinancialReport } from './reporting.service';

type ReportFormat = ReportExportQuery['format'];
type ReportStatement = ReportExportQuery['report'];

export interface ReportFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

const PDF_CONTENT_TYPE = 'application/pdf';
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

const STATEMENT_LABELS: Record<ReportStatement, string> = {
  'cash-flow': 'Cash flow statement',
  'profit-and-loss': 'Profit & loss statement',
  'balance-sheet': 'Balance sheet',
  all: 'Financial report',
};

const STATEMENT_SLUGS: Record<ReportStatement, string> = {
  'cash-flow': 'cash-flow',
  'profit-and-loss': 'profit-and-loss',
  'balance-sheet': 'balance-sheet',
  all: 'report',
};

function major(value: string, decimals: number): number {
  return Number(BigInt(value)) / 10 ** decimals;
}

function money(value: string, decimals: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major(value, decimals));
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function periodLabel(report: FinancialReport): string {
  return `${dateLabel(report.from)} – ${dateLabel(report.to)}`;
}

function periodText(report: FinancialReport, statement: ReportStatement): string {
  return statement === 'balance-sheet'
    ? `As of ${dateLabel(report.to)}`
    : periodLabel(report);
}

function filename(
  report: FinancialReport,
  extension: ReportFormat,
  statement: ReportStatement,
): string {
  return `keiz-${STATEMENT_SLUGS[statement]}-${report.currency}-${report.from.slice(0, 10)}-to-${report.to.slice(0, 10)}.${extension}`;
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class ReportingExportService {
  async export(
    report: FinancialReport,
    format: ReportFormat,
    statement: ReportStatement = 'all',
  ): Promise<ReportFile> {
    if (format === 'pdf') {
      return {
        buffer: await this.pdf(report, statement),
        contentType: PDF_CONTENT_TYPE,
        filename: filename(report, 'pdf', statement),
      };
    }
    if (format === 'csv') {
      return {
        buffer: this.csv(report, statement),
        contentType: CSV_CONTENT_TYPE,
        filename: filename(report, 'csv', statement),
      };
    }
    return {
      buffer: await this.xlsx(report, statement),
      contentType: XLSX_CONTENT_TYPE,
      filename: filename(report, 'xlsx', statement),
    };
  }

  private async xlsx(report: FinancialReport, statement: ReportStatement): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'KEIZ';
    workbook.created = new Date();

    if (statement === 'all') {
      this.addSummarySheet(workbook, report);
    }
    if (statement === 'all' || statement === 'cash-flow') {
      this.addCashFlowSheet(workbook, report);
    }
    if (statement === 'all' || statement === 'profit-and-loss') {
      this.addProfitAndLossSheet(workbook, report);
    }
    if (statement === 'all' || statement === 'balance-sheet') {
      this.addBalanceSheet(workbook, report);
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private addSummarySheet(workbook: Workbook, report: FinancialReport): void {
    const currency = report.currency;
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Metric', key: 'label', width: 32 },
      { header: `Amount (${currency})`, key: 'amount', width: 22, style: { numFmt: '#,##0.00' } },
    ];
    summary.addRows([
      { label: 'Period', amount: periodLabel(report) },
      { label: 'Currency', amount: currency },
      { label: 'Cash in', amount: major(report.cashFlow.inflow, report.decimals) },
      { label: 'Cash out', amount: major(report.cashFlow.outflow, report.decimals) },
      { label: 'Net cash', amount: major(report.cashFlow.net, report.decimals) },
      { label: 'Revenue', amount: major(report.profitAndLoss.totalRevenue, report.decimals) },
      { label: 'Expenses', amount: major(report.profitAndLoss.totalExpenses, report.decimals) },
      { label: 'Net profit', amount: major(report.profitAndLoss.netIncome, report.decimals) },
      { label: 'Total assets', amount: major(report.balanceSheet.totalAssets, report.decimals) },
      {
        label: 'Total liabilities',
        amount: major(report.balanceSheet.totalLiabilities, report.decimals),
      },
      { label: 'Total equity', amount: major(report.balanceSheet.totalEquity, report.decimals) },
      { label: 'Balanced', amount: report.balanceSheet.balanced ? 'Yes' : 'No' },
    ]);
    styleSheet(summary);
  }

  private addCashFlowSheet(workbook: Workbook, report: FinancialReport): void {
    const cash = workbook.addWorksheet('Cash Flow');
    cash.columns = [
      { header: 'Source', key: 'label', width: 28 },
      { header: 'Inflow', key: 'inflow', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'Outflow', key: 'outflow', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'Net', key: 'net', width: 18, style: { numFmt: '#,##0.00' } },
    ];
    cash.addRows(
      report.cashFlow.sources.map((source) => ({
        label: source.label,
        inflow: major(source.inflow, report.decimals),
        outflow: major(source.outflow, report.decimals),
        net: major(source.net, report.decimals),
      })),
    );
    cash.addRow({
      label: 'Total',
      inflow: major(report.cashFlow.inflow, report.decimals),
      outflow: major(report.cashFlow.outflow, report.decimals),
      net: major(report.cashFlow.net, report.decimals),
    });
    styleSheet(cash);
  }

  private addProfitAndLossSheet(workbook: Workbook, report: FinancialReport): void {
    const pnl = workbook.addWorksheet('Profit & Loss');
    pnl.columns = [
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Account', key: 'name', width: 32 },
      { header: 'Amount', key: 'amount', width: 18, style: { numFmt: '#,##0.00' } },
    ];
    pnl.addRows(
      report.profitAndLoss.revenueLines.map((line) => ({
        type: 'Revenue',
        code: line.code,
        name: line.name,
        amount: major(line.amount, report.decimals),
      })),
    );
    pnl.addRow({
      type: 'Total',
      name: 'Total revenue',
      amount: major(report.profitAndLoss.totalRevenue, report.decimals),
    });
    pnl.addRows(
      report.profitAndLoss.expenseLines.map((line) => ({
        type: 'Expense',
        code: line.code,
        name: line.name,
        amount: major(line.amount, report.decimals),
      })),
    );
    pnl.addRow({
      type: 'Total',
      name: 'Total expenses',
      amount: major(report.profitAndLoss.totalExpenses, report.decimals),
    });
    pnl.addRow({
      type: 'Total',
      name: 'Net income',
      amount: major(report.profitAndLoss.netIncome, report.decimals),
    });
    styleSheet(pnl);
  }

  private addBalanceSheet(workbook: Workbook, report: FinancialReport): void {
    const balance = workbook.addWorksheet('Balance Sheet');
    balance.columns = [
      { header: 'Section', key: 'section', width: 16 },
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Account', key: 'name', width: 32 },
      { header: 'Amount', key: 'amount', width: 18, style: { numFmt: '#,##0.00' } },
    ];
    const balanceRows = [
      ...report.balanceSheet.assetLines.map((line) => ({ ...line, section: 'Asset' })),
      ...report.balanceSheet.liabilityLines.map((line) => ({ ...line, section: 'Liability' })),
      ...report.balanceSheet.equityLines.map((line) => ({ ...line, section: 'Equity' })),
    ];
    balance.addRows(
      balanceRows.map((line) => ({
        section: line.section,
        code: line.code,
        name: line.name,
        amount: major(line.amount, report.decimals),
      })),
    );
    balance.addRow({
      section: 'Total',
      name: 'Total assets',
      amount: major(report.balanceSheet.totalAssets, report.decimals),
    });
    balance.addRow({
      section: 'Total',
      name: 'Total liabilities',
      amount: major(report.balanceSheet.totalLiabilities, report.decimals),
    });
    balance.addRow({
      section: 'Total',
      name: 'Total equity',
      amount: major(report.balanceSheet.totalEquity, report.decimals),
    });
    balance.addRow({
      section: 'Check',
      name: 'Balanced',
      amount: report.balanceSheet.balanced ? 'Yes' : 'No',
    });
    styleSheet(balance);
  }

  private csv(report: FinancialReport, statement: ReportStatement): Buffer {
    const rows: string[][] = [
      ['Statement', STATEMENT_LABELS[statement]],
      ['Period', periodText(report, statement)],
      ['Currency', report.currency],
      ['Generated', new Date().toISOString()],
      [],
    ];

    if (statement === 'all' || statement === 'cash-flow') {
      rows.push(['Cash flow'], ['Source', 'Inflow', 'Outflow', 'Net']);
      for (const source of report.cashFlow.sources) {
        rows.push([
          source.label,
          major(source.inflow, report.decimals).toFixed(2),
          major(source.outflow, report.decimals).toFixed(2),
          major(source.net, report.decimals).toFixed(2),
        ]);
      }
      rows.push([
        'Net cash',
        major(report.cashFlow.inflow, report.decimals).toFixed(2),
        major(report.cashFlow.outflow, report.decimals).toFixed(2),
        major(report.cashFlow.net, report.decimals).toFixed(2),
      ]);
      rows.push([]);
    }

    if (statement === 'all' || statement === 'profit-and-loss') {
      rows.push(['Profit & loss'], ['Type', 'Code', 'Account', 'Amount']);
      for (const line of report.profitAndLoss.revenueLines) {
        rows.push(['Revenue', line.code, line.name, major(line.amount, report.decimals).toFixed(2)]);
      }
      rows.push(['Total', '', 'Total revenue', major(report.profitAndLoss.totalRevenue, report.decimals).toFixed(2)]);
      for (const line of report.profitAndLoss.expenseLines) {
        rows.push(['Expense', line.code, line.name, major(line.amount, report.decimals).toFixed(2)]);
      }
      rows.push(['Total', '', 'Total expenses', major(report.profitAndLoss.totalExpenses, report.decimals).toFixed(2)]);
      rows.push(['Total', '', 'Net income', major(report.profitAndLoss.netIncome, report.decimals).toFixed(2)]);
      rows.push([]);
    }

    if (statement === 'all' || statement === 'balance-sheet') {
      rows.push(['Balance sheet'], ['Section', 'Code', 'Account', 'Amount']);
      const lines = [
        ...report.balanceSheet.assetLines.map((line) => ({ ...line, section: 'Asset' })),
        ...report.balanceSheet.liabilityLines.map((line) => ({ ...line, section: 'Liability' })),
        ...report.balanceSheet.equityLines.map((line) => ({ ...line, section: 'Equity' })),
      ];
      for (const line of lines) {
        rows.push([line.section, line.code, line.name, major(line.amount, report.decimals).toFixed(2)]);
      }
      rows.push(['Total', '', 'Total assets', major(report.balanceSheet.totalAssets, report.decimals).toFixed(2)]);
      rows.push(['Total', '', 'Total liabilities', major(report.balanceSheet.totalLiabilities, report.decimals).toFixed(2)]);
      rows.push(['Total', '', 'Total equity', major(report.balanceSheet.totalEquity, report.decimals).toFixed(2)]);
      rows.push(['Check', '', 'Balanced', report.balanceSheet.balanced ? 'Yes' : 'No']);
    }

    return Buffer.from(rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n'), 'utf8');
  }

  private async pdf(report: FinancialReport, statement: ReportStatement): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const width = doc.page.width - 96;
      const right = 48 + width;
      const amount = (value: string) => money(value, report.decimals, report.currency);

      doc.fontSize(20).fillColor('#0b0d12').text('KEIZ', { continued: true });
      doc.fontSize(10).fillColor('#6b6f76').text(`  ${STATEMENT_LABELS[statement]}`);
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#0b0d12').text(periodText(report, statement));
      doc.fontSize(9).fillColor('#6b6f76').text(`All amounts in ${report.currency}`);
      doc.moveDown(0.8);

      const rule = () => {
        doc.moveDown(0.35);
        doc
          .moveTo(48, doc.y)
          .lineTo(right, doc.y)
          .strokeColor('#e5e5df')
          .lineWidth(0.8)
          .stroke();
        doc.moveDown(0.45);
      };

      const heading = (text: string) => {
        ensure(doc, 46);
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor('#0b0d12').text(text);
        rule();
      };

      const row = (label: string, value: string, bold = false) => {
        ensure(doc, 20);
        const y = doc.y;
        doc.fontSize(9).fillColor(bold ? '#0b0d12' : '#333333');
        doc.text(label, 48, y, { width: width - 130 });
        doc.text(value, right - 130, y, { width: 130, align: 'right' });
        doc.y = y + 15;
      };

      const showSectionHeadings = statement === 'all';

      if (statement === 'all') {
        heading('Summary');
        row('Cash in', amount(report.cashFlow.inflow));
        row('Cash out', amount(report.cashFlow.outflow));
        row('Net cash', amount(report.cashFlow.net), true);
        row('Revenue', amount(report.profitAndLoss.totalRevenue));
        row('Expenses', amount(report.profitAndLoss.totalExpenses));
        row('Net profit', amount(report.profitAndLoss.netIncome), true);
      }

      if (statement === 'all' || statement === 'cash-flow') {
        if (showSectionHeadings) heading('Cash flow');
        if (report.cashFlow.sources.length === 0) {
          row('No cash movement in this period', '—');
        } else {
          for (const source of report.cashFlow.sources) {
            row(source.label, `in ${amount(source.inflow)} · out ${amount(source.outflow)}`);
          }
          row('Net cash', amount(report.cashFlow.net), true);
        }
      }

      if (statement === 'all' || statement === 'profit-and-loss') {
        if (showSectionHeadings) heading('Profit & loss');
        if (
          report.profitAndLoss.revenueLines.length === 0 &&
          report.profitAndLoss.expenseLines.length === 0
        ) {
          row('No revenue or expense entries in this period', '—');
        } else {
          for (const line of report.profitAndLoss.revenueLines) {
            row(`${line.code} ${line.name}`, amount(line.amount));
          }
          row('Total revenue', amount(report.profitAndLoss.totalRevenue), true);
          for (const line of report.profitAndLoss.expenseLines) {
            row(`${line.code} ${line.name}`, amount(line.amount));
          }
          row('Total expenses', amount(report.profitAndLoss.totalExpenses), true);
          row('Net income', amount(report.profitAndLoss.netIncome), true);
        }
      }

      if (statement === 'all' || statement === 'balance-sheet') {
        if (showSectionHeadings) heading('Balance sheet');
        for (const line of report.balanceSheet.assetLines) {
          row(`${line.code} ${line.name}`, amount(line.amount));
        }
        row('Total assets', amount(report.balanceSheet.totalAssets), true);
        for (const line of report.balanceSheet.liabilityLines) {
          row(`${line.code} ${line.name}`, amount(line.amount));
        }
        row('Total liabilities', amount(report.balanceSheet.totalLiabilities), true);
        for (const line of report.balanceSheet.equityLines) {
          row(`${line.code} ${line.name}`, amount(line.amount));
        }
        row('Total equity', amount(report.balanceSheet.totalEquity), true);
        row(
          'Total liabilities + equity',
          amount(
            (
              BigInt(report.balanceSheet.totalLiabilities) +
              BigInt(report.balanceSheet.totalEquity)
            ).toString(),
          ),
          true,
        );
        row('Balanced', report.balanceSheet.balanced ? 'Yes' : 'No', true);
      }

      const pages = doc.bufferedPageRange();
      for (let index = 0; index < pages.count; index += 1) {
        doc.switchToPage(index);
        doc
          .fontSize(8)
          .fillColor('#6b6f76')
          .text(`Page ${index + 1} of ${pages.count}`, 48, doc.page.height - 34, {
            width,
            align: 'right',
          });
      }

      doc.end();
    });
  }
}

function ensure(doc: PDFKit.PDFDocument, height: number): void {
  if (doc.y + height > doc.page.height - 60) doc.addPage();
}

function styleSheet(sheet: Worksheet): void {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0B0D12' },
  };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}
