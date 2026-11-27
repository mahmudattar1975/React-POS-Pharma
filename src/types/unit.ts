// Unit-of-measure master ("وحدات القياس"), mirrored from dbo.Units. The Item Master stores
// UnitNameEn in Item.unit so existing POS/receipt labels and legacy free text keep working; the
// numeric UnitID is kept in SQL for reporting and future FK backfill.
export interface Unit {
  unitId: number;
  unitCode: string;
  nameAr: string;
  nameEn: string;
  // undefined = active, like Item.isActive, so older persisted copies keep every row selectable.
  isActive?: boolean;
}
