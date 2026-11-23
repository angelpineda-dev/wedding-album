import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { env } from '../config/env.ts';

/** Path of the web app route that opens an event's gallery. */
const PUBLIC_EVENT_PATH = '/e/';

/** The link the QR encodes and guests can share. */
export const publicEventUrl = (publicCode: string): string =>
    new URL(`${PUBLIC_EVENT_PATH}${publicCode}`, env.APP_PUBLIC_URL).toString();

/**
 * Error correction M (~15 % damage tolerated) keeps the code dense enough to print small
 * while surviving a crease or a glare on a table card.
 */
const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 2 } as const;

/** Square PNG, large enough to print sharp at ~10 cm. */
export function renderQrPng(publicCode: string, width = 1024): Promise<Buffer> {
    return QRCode.toBuffer(publicEventUrl(publicCode), { ...QR_OPTIONS, type: 'png', width });
}

export interface PrintableEvent {
    name: string;
    publicCode: string;
    opensAt: Date;
    closesAt: Date;
    timezone: string;
}

/** "sáb 14 mar, 16:00" in the event's own time zone. */
const formatInZone = (date: Date, timeZone: string) =>
    new Intl.DateTimeFormat('es-MX', {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);

/** One letter-size page to print and place on tables: name, QR, link and upload hours. */
export async function renderQrPdf(event: PrintableEvent): Promise<Buffer> {
    const png = await renderQrPng(event.publicCode, 900);
    const doc = new PDFDocument({ size: 'LETTER', margin: 72, info: { Title: `QR · ${event.name}` } });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 144;
    const qrSize = 340;

    doc.fillColor('#2F6B52').font('Helvetica-Bold').fontSize(14)
        .text('COMPARTE TUS FOTOS', 72, 96, { width: contentWidth, align: 'center', characterSpacing: 2 });
    doc.fillColor('#1E2320').font('Helvetica-Bold').fontSize(36)
        .text(event.name, 72, 130, { width: contentWidth, align: 'center' });

    doc.image(png, (pageWidth - qrSize) / 2, 220, { width: qrSize, height: qrSize });

    doc.fillColor('#3E4541').font('Helvetica').fontSize(16)
        .text('Escanea para ver la galería y subir tus fotos y videos', 72, 590, { width: contentWidth, align: 'center' });
    doc.fillColor('#5B625E').fontSize(13)
        .text(publicEventUrl(event.publicCode), { width: contentWidth, align: 'center' })
        .moveDown(0.5)
        .text(`Subidas: ${formatInZone(event.opensAt, event.timezone)} – ${formatInZone(event.closesAt, event.timezone)}`, {
            width: contentWidth,
            align: 'center',
        });

    doc.end();
    return done;
}
