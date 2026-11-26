// Downloadable template for the Excel item import. The first sheet is the one the dialog reads, so
// its headers must match the aliases in itemImport.ts; the second sheet is guidance only and is
// ignored by the importer. Keeping this here (rather than inside the dialog) makes the template
// testable without a browser and keeps `xlsx` out of the initial bundle.
export const ITEM_IMPORT_SAMPLE_HEADERS: string[] = [
  'Barcode',
  'Item Name (English)',
  'Arabic Name',
  'Sale Price',
  'VAT %',
  'Category',
  'Unit',
  'Reorder Level',
  'Controlled Status',
  'Requires Batch Tracking',
  'Active',
];

export const ITEM_IMPORT_SAMPLE_ROW: Record<string, string | number> = {
  Barcode: 'SAMPLE-0001',
  'Item Name (English)': 'Sample Item - replace or delete this row',
  'Arabic Name': 'صنف تجريبي - استبدله أو احذفه',
  'Sale Price': 12.5,
  'VAT %': '15%',
  Category: 'Analgesics',
  Unit: 'Box',
  'Reorder Level': 10,
  'Controlled Status': '',
  'Requires Batch Tracking': 'Yes',
  Active: 'Yes',
};

const GUIDE_ROWS: (string | number)[][] = [
  ['Column', 'Required', 'Example', 'Notes'],
  ['Barcode', 'Yes', '6281007320999', '4-32 letters/digits/dot/dash/underscore. Unique across both item tables.'],
  ['Item Name (English)', 'Yes', 'Paracetamol 500mg', 'Used by the .NET item master and POS search.'],
  ['Arabic Name', 'No', 'باراسيتامول 500 مجم', 'Optional, but recommended for receipts and labels.'],
  ['Sale Price', 'No', '12.50', 'Blank becomes 0.00; the preview will flag it.'],
  ['VAT %', 'No', '15%', 'Accepts 0.15, 15 or 15%. Zero-rated items can use 0.'],
  ['Category', 'No', 'Analgesics', 'Free text; used for grouping in Item Master.'],
  ['Unit', 'No', 'Box', 'Free text, e.g. Box, Strip, Tablet.'],
  ['Reorder Level', 'No', '10', 'Whole number, 0 or more.'],
  ['Controlled Status', 'No', 'prescription', 'Blank = none. Also accepts schedule_a ... schedule_e.'],
  ['Requires Batch Tracking', 'No', 'Yes', 'Yes/No. Defaults to Yes when blank.'],
  ['Active', 'No', 'Yes', 'Yes/No. Defaults to Yes when blank.'],
  ['', '', '', ''],
  ['TIP', '', '', 'Delete the sample row before importing your own items. Arabic headers are also recognised.'],
];

// Exported for tests so the template's first sheet can be inspected without downloading a file.
export async function buildItemImportSampleWorkbook() {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  const items = XLSX.utils.aoa_to_sheet([
    ITEM_IMPORT_SAMPLE_HEADERS,
    ITEM_IMPORT_SAMPLE_HEADERS.map((header) => ITEM_IMPORT_SAMPLE_ROW[header] ?? ''),
  ]);
  items['!cols'] = [
    { wch: 18 }, { wch: 38 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 16 },
    { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(workbook, items, 'Items');

  const guide = XLSX.utils.aoa_to_sheet(GUIDE_ROWS);
  guide['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 24 }, { wch: 68 }];
  XLSX.utils.book_append_sheet(workbook, guide, 'How to fill');

  return workbook;
}

export async function downloadItemImportSample(): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = await buildItemImportSampleWorkbook();
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'item-import-sample.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
