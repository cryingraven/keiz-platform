import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { PublicDocument } from './documents.types';

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

function unitPrice(value: string, currency: string): string {
  const amount = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

@Injectable()
export class DocumentPdfService {
  async render(document: PublicDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const width = doc.page.width - 96;
      const right = 48 + width;
      const amount = (value: string) => money(value, document.decimals, document.currency);

      const ensure = (height: number) => {
        if (doc.y + height > doc.page.height - 60) doc.addPage();
      };

      doc.fontSize(20).fillColor('#0b0d12').text('KEIZ', { continued: true });
      doc.fontSize(10).fillColor('#6b6f76').text(`  ${document.title}`);
      doc.moveDown(0.35);
      doc.fontSize(9).fillColor('#6b6f76').text(document.organizationName);
      doc.moveDown(0.7);

      const headerY = doc.y;
      doc.fontSize(18).fillColor('#0b0d12').text(document.number, 48, headerY, {
        width: width / 2,
      });
      doc.fontSize(9).fillColor('#6b6f76').text(`${document.title} · ${document.status}`, 48, headerY + 25);
      doc.fontSize(9).fillColor('#6b6f76').text(
        `Issued ${dateLabel(document.issueDate)}`,
        right - 180,
        headerY,
        { width: 180, align: 'right' },
      );
      doc.text(`Due ${dateLabel(document.dueDate)}`, right - 180, headerY + 14, {
        width: 180,
        align: 'right',
      });
      doc.y = headerY + 54;

      const detailY = doc.y;
      const label = document.kind === 'bill' ? 'Vendor' : 'Bill to';
      doc.fontSize(9).fillColor('#6b6f76').text(label.toUpperCase(), 48, detailY);
      doc.fontSize(11).fillColor('#0b0d12').text(document.counterparty.name, 48, detailY + 14);
      doc.fontSize(9).fillColor('#6b6f76').text(document.counterparty.email, 48, detailY + 30);
      let detailCursor = detailY + 44;
      if (document.counterparty.billingAddress) {
        doc.text(document.counterparty.billingAddress, 48, detailCursor, { width: 220 });
        detailCursor += 24;
      }
      if (document.counterparty.taxId) {
        doc.text(`Tax ID: ${document.counterparty.taxId}`, 48, detailCursor);
      }
      doc.y = Math.max(detailCursor + 18, detailY + 70);

      doc
        .moveTo(48, doc.y)
        .lineTo(right, doc.y)
        .strokeColor('#e5e5df')
        .lineWidth(0.8)
        .stroke();
      doc.moveDown(0.5);

      const columns = {
        description: 48,
        quantity: 300,
        unit: 350,
        amount: right - 120,
      };
      const widths = {
        description: 240,
        quantity: 42,
        unit: 90,
        amount: 120,
      };

      const row = (
        description: string,
        quantity: string,
        unit: string,
        value: string,
        header = false,
      ) => {
        const height = Math.max(doc.heightOfString(description, { width: widths.description }), 14) + 10;
        ensure(height + 8);
        const y = doc.y;
        doc
          .fontSize(9)
          .fillColor(header ? '#6b6f76' : '#0b0d12')
          .text(description, columns.description, y, { width: widths.description });
        doc
          .fillColor(header ? '#6b6f76' : '#333333')
          .text(quantity, columns.quantity, y, { width: widths.quantity, align: 'right' });
        doc.text(unit, columns.unit, y, { width: widths.unit, align: 'right' });
        doc.text(value, columns.amount, y, { width: widths.amount, align: 'right' });
        doc.y = y + height;
      };

      row('Description', 'Qty', 'Unit', 'Amount', true);
      doc
        .moveTo(48, doc.y)
        .lineTo(right, doc.y)
        .strokeColor('#e5e5df')
        .lineWidth(0.6)
        .stroke();
      doc.moveDown(0.2);
      for (const line of document.lineItems) {
        row(
          line.description,
          line.quantity,
          unitPrice(line.unitPrice, document.currency),
          amount(line.lineTotal),
        );
      }
      doc
        .moveTo(48, doc.y)
        .lineTo(right, doc.y)
        .strokeColor('#e5e5df')
        .lineWidth(0.6)
        .stroke();
      doc.moveDown(0.5);

      const totalRow = (labelText: string, value: string, bold = false) => {
        ensure(18);
        const y = doc.y;
        doc
          .fontSize(9)
          .fillColor(bold ? '#0b0d12' : '#6b6f76')
          .text(labelText, right - 220, y, { width: 120, align: 'right' });
        doc
          .fillColor(bold ? '#0b0d12' : '#0b0d12')
          .text(value, right - 90, y, { width: 90, align: 'right' });
        doc.y = y + 15;
      };

      totalRow('Subtotal', amount(document.subtotal));
      totalRow(`Tax (${(document.taxBps / 100).toFixed(2)}%)`, amount(document.taxAmount));
      totalRow('Total', amount(document.total), true);
      if (document.paidAmount !== undefined) {
        totalRow('Amount paid', amount(document.paidAmount));
      }
      if (document.amountDue !== undefined) {
        totalRow('Amount due', amount(document.amountDue), true);
      }

      if (document.notes) {
        ensure(70);
        doc.moveDown(0.7);
        doc.fontSize(9).fillColor('#6b6f76').text('NOTES');
        doc.moveDown(0.2);
        doc.fontSize(9).fillColor('#0b0d12').text(document.notes, { width });
      }

      ensure(50);
      doc.moveDown(1);
      doc
        .fontSize(8)
        .fillColor('#6b6f76')
        .text(
          document.expiresAt
            ? `Shared by ${document.organizationName} · Link expires ${dateLabel(document.expiresAt)}`
            : `Generated by ${document.organizationName} · ${new Date().toISOString().slice(0, 10)}`,
          48,
          doc.y,
          { width, align: 'center' },
        );

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
