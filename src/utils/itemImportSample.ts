// Downloadable template for the Excel item import. The first sheet is the one the dialog reads, so
// its headers match the owner's ERP export exactly; the second sheet is guidance only and is
// ignored by the importer. Keeping this here (rather than inside the dialog) makes the template
// testable without a browser and keeps `xlsx` out of the initial bundle.
export const ITEM_IMPORT_SAMPLE_HEADERS: string[] = [
  'Barcode',
  'Name',
  'Product Category',
  'Brand',
  'Vendor',
  'Manufactured',
  'Cost',
  'Sales Price',
  'Customer Taxes',
];

// Two lines with the same English name demonstrate the real sheets: the importer creates ONE item
// and stores the second barcode as an alias in dbo.ItemBarcodes.
export const ITEM_IMPORT_SAMPLE_ROW: Record<string, string | number> = {
  Barcode: '5247619187585',
  Name: 'Sample Item - replace or delete these rows',
  'Product Category': 'All / COSMOTICS',
  Brand: 'BEESLINE',
  Vendor: '',
  Manufactured: 'BEESLINE',
  Cost: 0,
  'Sales Price': 99,
  'Customer Taxes': '15 Sales',
};

export const ITEM_IMPORT_SAMPLE_ROWS: Record<string, string | number>[] = [
  ITEM_IMPORT_SAMPLE_ROW,
  {
    ...ITEM_IMPORT_SAMPLE_ROW,
    Barcode: '5281018089071',
  },
];

const GUIDE_ROWS: (string | number)[][] = [
  ['Column', 'Required', 'Example', 'Notes'],
  ['Barcode', 'Yes', '6281007320999', '4-32 letters/digits/dot/dash/@/underscore. Format the Excel column as Text before pasting; scientific notation such as 6.9442E+12 is expanded on import. Legacy codes like 04694@43983 are accepted.'],
  ['Name', 'Yes', 'BEESLINE SUN SCREEN F/ FLUID 50 40ML', 'Case and extra spaces do not matter. Rows with the SAME name become one item; each row barcode is saved as an alias on that item.'],
  ['Product Category', 'No', 'All / COSMOTICS', 'Free text from the ERP, e.g. All / MEDICAL SUPPLIES. Written as-is to the item category label.'],
  ['Brand', 'No', 'BEESLINE', 'Ignored by the item master (no brand column is written).'],
  ['Vendor', 'No', 'VENDOR-001', 'Saved as the item preferred vendor number when present.'],
  ['Manufactured', 'No', 'BEESLINE', 'Saved as the item manufacturer number when present.'],
  ['Cost', 'No', '0.00', 'Ignored: purchase cost belongs to a batch, and this import creates no batches or stock.'],
  ['Sales Price', 'No', '99.00', 'Blank becomes 0.00; the preview shows the value before you apply.'],
  ['Customer Taxes', 'No', '15 Sales', 'The numeric part is the VAT rate: 15 or 15% means 15%, 0 means zero-rated. The trailing tax label is ignored.'],
  ['', '', '', ''],
  ['TIP', '', '', 'Delete both sample rows before importing your own items. Rows 1 and 2 have the same name on purpose: they become one item with two scannable barcodes.'],
];

// Exported for tests so the template's first sheet can be inspected without downloading a file.
export async function buildItemImportSampleWorkbook() {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  const items = XLSX.utils.aoa_to_sheet([
    ITEM_IMPORT_SAMPLE_HEADERS,
    ...ITEM_IMPORT_SAMPLE_ROWS.map((row) => ITEM_IMPORT_SAMPLE_HEADERS.map((header) => row[header] ?? '')),
  ]);
  items['!cols'] = [
    { wch: 18 }, { wch: 42 }, { wch: 26 }, { wch: 16 }, { wch: 16 },
    { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(workbook, items, 'Items');

  const guide = XLSX.utils.aoa_to_sheet(GUIDE_ROWS);
  guide['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 40 }, { wch: 84 }];
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
