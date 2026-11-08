// Manufacturer / company master ("بيانات الشركات الصانعة"), modelled on the legacy company-data
// screen: a numeric company number ("رقم الشركة") that runs from the last used number ("اخر رقم"),
// Arabic + English names, and a free-text detailed-data block ("بيانات تفصيلية").
//
// The company NUMBER is the stable key stored on Item.manufacturerNo, so renaming a company never
// breaks the link from the item master rows.
export interface Manufacturer {
  id: string;
  // Numeric running number, exactly like the legacy FCODCORP.corp_no. A new company defaults to
  // the next free number but the owner may type a different one (still unique + >= 1).
  companyNo: number;
  nameAr: string;
  nameEn: string;
  // "بيانات تفصيلية" - free-text address / contact person / phone / licence notes. Kept as one
  // block because the legacy screen's detail area was free text, not a fixed schema.
  details?: string;
  // undefined = active, the same convention as Item.isActive (every row saved before the switch
  // existed, and every imported row, keeps working).
  isActive?: boolean;
  // Last save timestamp (ISO) - the list's "last updated" column, like FCODCORP.fmodifiedon.
  updatedAt?: string;
}
