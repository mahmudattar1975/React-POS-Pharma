// Shelf/store location master, mirrored from dbo.Locations. Item.location stays an app-level text
// label (there is no SQL column on dbo.items yet); the Item Master chooses that label from here so
// every till uses the same shelf names without breaking older local catalogues.
export interface Location {
  locationId: number;
  locationCode: string;
  nameAr: string;
  nameEn: string;
  // undefined = active, like Item.isActive.
  isActive?: boolean;
}
