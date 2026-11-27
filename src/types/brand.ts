// Brand master ("العلامات التجارية"), mirrored from dbo.BrandMaster. The Item Master links to a
// stable BrandID; English and Arabic names are both maintained in the master screen. Optional
// manufacturer/country metadata exists in SQL but is not edited by the masters screen yet.
export interface Brand {
  brandId: number;
  brandCode: string;
  nameAr: string;
  nameEn: string;
  manufacturerId?: number | null;
  countryOfOrigin?: string | null;
  // undefined = active, like Item.isActive, so older persisted copies keep every row selectable.
  isActive?: boolean;
}
