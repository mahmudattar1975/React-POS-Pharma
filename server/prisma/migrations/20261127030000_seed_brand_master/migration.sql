-- Seeds the approved BrandMaster lookup for the Item Master. Ids and codes are stable
-- (BR-0001..BR-0131) so an offline terminal and the SQL master resolve the same brand. The Arabic
-- column holds Arabic-script transliterations of these proper nouns; the English column is verbatim.
-- Guarded by both BrandID and BrandCode, so rerunning the migration is a no-op.

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[BrandMaster]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[BrandMaster] (
        [BrandID] INT IDENTITY(1, 1) NOT NULL
            CONSTRAINT [BrandMaster_pkey] PRIMARY KEY CLUSTERED,
        [BrandCode] NVARCHAR(50) NOT NULL
            CONSTRAINT [BrandMaster_BrandCode_key] UNIQUE NONCLUSTERED,
        [BrandNameEn] NVARCHAR(150) NOT NULL,
        [BrandNameAr] NVARCHAR(150) NOT NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_BrandMaster_IsActive] DEFAULT 1
    );
END;

SET IDENTITY_INSERT [dbo].[BrandMaster] ON;

;WITH [seed] ([BrandID], [BrandCode], [BrandNameAr], [BrandNameEn]) AS (
    SELECT * FROM (VALUES
        (1, N'BR-0001', N'انجيل', N'ANGEL'),
        (2, N'BR-0002', N'انيڤاجيني', N'ANIVAGENE'),
        (3, N'BR-0003', N'ارجينتا', N'Argenta'),
        (4, N'BR-0004', N'بابي زوني', N'BABY ZONE'),
        (5, N'BR-0005', N'بابي دار', N'BABY DAR'),
        (6, N'BR-0006', N'بابي جوي', N'BABY JOY'),
        (7, N'BR-0007', N'بامبي', N'BAMBI'),
        (8, N'BR-0008', N'بامبوو', N'BAMBOO'),
        (9, N'BR-0009', N'بيبيدور', N'BEBEDOR'),
        (10, N'BR-0010', N'بيكوتان', N'BECUTAN'),
        (11, N'BR-0011', N'بيللي', N'BELLE'),
        (12, N'BR-0012', N'بولڤير', N'BOLVER'),
        (13, N'BR-0013', N'بلوي كاپ', N'BLUE CAP'),
        (14, N'BR-0014', N'بوريال', N'BOREAL'),
        (15, N'BR-0015', N'كاريببيان', N'CARIBBEAN'),
        (16, N'BR-0016', N'كونويلل', N'CONWELL'),
        (17, N'BR-0017', N'كووجيي', N'COOGIE'),
        (18, N'BR-0018', N'كوراكجن', N'CORAKJN'),
        (19, N'BR-0019', N'كرياتيڤي', N'CREATIVE'),
        (20, N'BR-0020', N'داكس', N'DAX'),
        (21, N'BR-0021', N'دكل', N'DCL'),
        (22, N'BR-0022', N'دي لا كروزي', N'DE LA CRUZE'),
        (23, N'BR-0023', N'ديبيست', N'DEBEST'),
        (24, N'BR-0024', N'دييپ', N'DEEP'),
        (25, N'BR-0025', N'ديلوكس', N'DELUX'),
        (26, N'BR-0026', N'ديلوكسي', N'DELUXE'),
        (27, N'BR-0027', N'دينتيك', N'DENTEK'),
        (28, N'BR-0028', N'پياڤي', N'PIAVE'),
        (29, N'BR-0029', N'سيلڤير كاري', N'SILVER CARE'),
        (30, N'BR-0030', N'ديو 7', N'DEO 7'),
        (31, N'BR-0031', N'ديونات', N'DEONAT'),
        (32, N'BR-0032', N'ديپيند', N'DEPEND'),
        (33, N'BR-0033', N'ديپوردينت', N'DEPURDENT'),
        (34, N'BR-0034', N'ديرما', N'DERMA'),
        (35, N'BR-0035', N'ديرما-ي', N'DERMA-E'),
        (36, N'BR-0036', N'ديرما پيللا', N'DERMA PELLA'),
        (37, N'BR-0037', N'ديرماكوتيك', N'DERMACUTIC'),
        (38, N'BR-0038', N'ديرمادوكتور', N'DERMADOCTOR'),
        (39, N'BR-0039', N'ديرماجور', N'DERMAGOR'),
        (40, N'BR-0040', N'ديرماكوال', N'DERMAQUAL'),
        (41, N'BR-0041', N'ديرمارايس', N'DERMARAYS'),
        (42, N'BR-0042', N'ديرماريني', N'DERMARINE'),
        (43, N'BR-0043', N'ديرماسينكي', N'DERMASENCE'),
        (44, N'BR-0044', N'ديرميديك', N'DERMEDIC'),
        (45, N'BR-0045', N'ديرميلار', N'DERMELAR'),
        (46, N'BR-0046', N'ديرميكيلپ', N'DERMIKELP'),
        (47, N'BR-0047', N'ديفييل', N'DIFEEL'),
        (48, N'BR-0048', N'ديفييلڤيتامين', N'DIFEELVITAMIN'),
        (49, N'BR-0049', N'ديناداكس', N'DINADAX'),
        (50, N'BR-0050', N'هاير كليپپير', N'HAIR CLIPPER'),
        (51, N'BR-0051', N'دولپهين', N'DOLPHIN'),
        (52, N'BR-0052', N'دورو', N'DURU'),
        (53, N'BR-0053', N'يليا', N'ELEA'),
        (54, N'BR-0054', N'يلجيديوم', N'ELGYDIUM'),
        (55, N'BR-0055', N'يليسهاكوي', N'ELISHACOY'),
        (56, N'BR-0056', N'لوريال', N'LOREAL'),
        (57, N'BR-0057', N'يمبريوليسسي', N'EMBRYOLISSE'),
        (58, N'BR-0058', N'ينيرجيا', N'ENERGIA'),
        (59, N'BR-0059', N'ينسوري', N'ENSURE'),
        (60, N'BR-0060', N'في', N'FE'),
        (61, N'BR-0061', N'فياتهير', N'FEATHER'),
        (62, N'BR-0062', N'فوور فرويت', N'FOUR FRUIT'),
        (63, N'BR-0063', N'فريينڤيتا', N'FRIENVITA'),
        (64, N'BR-0064', N'فريسو جولد', N'FRISO GOLD'),
        (65, N'BR-0065', N'جابريني', N'GABRINI'),
        (66, N'BR-0066', N'جيربير', N'GERBER'),
        (67, N'BR-0067', N'جاردين', N'GARDEN'),
        (68, N'BR-0068', N'وليا', N'OLIA'),
        (69, N'BR-0069', N'جازيللي', N'GAZELLE'),
        (70, N'BR-0070', N'جب', N'GB'),
        (71, N'BR-0071', N'جينوڤي', N'GENOVE'),
        (72, N'BR-0072', N'جمپ', N'GMP'),
        (73, N'BR-0073', N'جيرارديس', N'GERARDES'),
        (74, N'BR-0074', N'جيراتهيرم', N'GERATHERM'),
        (75, N'BR-0075', N'جوهنسون', N'JOHNSON'),
        (76, N'BR-0076', N'جيجا فريسه', N'GIGA FRESH'),
        (77, N'BR-0077', N'جيلليتتي', N'GILLETTE'),
        (78, N'BR-0078', N'جينجير', N'GINGER'),
        (79, N'BR-0079', N'جيوڤاني', N'GIOVANI'),
        (80, N'BR-0080', N'جيوڤانني', N'GIOVANNI'),
        (81, N'BR-0081', N'جلاموور', N'GLAMOUR'),
        (82, N'BR-0082', N'جليتز', N'GLITZ'),
        (83, N'BR-0083', N'جلوبال', N'GLOBAL'),
        (84, N'BR-0084', N'جلوڤ', N'GLOV'),
        (85, N'BR-0085', N'جاردين وليان', N'JARDIN OLEAN'),
        (86, N'BR-0086', N'جومازينج', N'Gumazing'),
        (87, N'BR-0087', N'ه و ب', N'H&B'),
        (88, N'BR-0088', N'ه و ت', N'H&T'),
        (89, N'BR-0089', N'هاير ديي', N'HAIR DYE'),
        (90, N'BR-0090', N'ي-م', N'I-M'),
        (91, N'BR-0091', N'يوود', N'IOUD'),
        (92, N'BR-0092', N'يسيلاك', N'ISILAC'),
        (93, N'BR-0093', N'كوتيكس', N'KOTEX'),
        (94, N'BR-0094', N'لاسير', N'LASER'),
        (95, N'BR-0095', N'ماليبو', N'MALIBU'),
        (96, N'BR-0096', N'ماندي كاري', N'MANDY CARE'),
        (97, N'BR-0097', N'ميكيتيفيندي', N'MECITEFENDI'),
        (98, N'BR-0098', N'ميديهيال', N'MEDIHEAL'),
        (99, N'BR-0099', N'نوو', N'NOW'),
        (100, N'BR-0100', N'نورالاك', N'NURALAC'),
        (101, N'BR-0101', N'ولاي', N'OLAY'),
        (102, N'BR-0102', N'ومرون', N'OMRON'),
        (103, N'BR-0103', N'وپتيفريي', N'optifree'),
        (104, N'BR-0104', N'ورالجين', N'ORALGIN'),
        (105, N'BR-0105', N'ورج', N'ORG'),
        (106, N'BR-0106', N'ورجانيك', N'ORGANIC'),
        (107, N'BR-0107', N'ورجانيك', N'ORGANYC'),
        (108, N'BR-0108', N'ورتهو', N'ORTHO'),
        (109, N'BR-0109', N'ورتهومول', N'ORTHOMOL'),
        (110, N'BR-0110', N'پانتهوپهيل', N'PANTHOPHIL'),
        (111, N'BR-0111', N'ردل', N'RDL'),
        (112, N'BR-0112', N'پاراكهوت', N'PARACHUT'),
        (113, N'BR-0113', N'پاراففين', N'PARAFFIN'),
        (114, N'BR-0114', N'پارايد', N'PARAID'),
        (115, N'BR-0115', N'پارانوڤا', N'PARANOVA'),
        (116, N'BR-0116', N'پاريس', N'PARIS'),
        (117, N'BR-0117', N'پارودونت', N'PARODONT'),
        (118, N'BR-0118', N'پهيليپس', N'PHILIPS'),
        (119, N'BR-0119', N'پهيتوريلاكس', N'PHYTORELAX'),
        (120, N'BR-0120', N'پيك', N'PIC'),
        (121, N'BR-0121', N'پلاستيك', N'PLASTIC'),
        (122, N'BR-0122', N'پلومپ', N'PLUMP'),
        (123, N'BR-0123', N'پوهلي', N'POHLI'),
        (124, N'BR-0124', N'پريڤيا', N'PREVIA'),
        (125, N'BR-0125', N'پريفا', N'PRIFA'),
        (126, N'BR-0126', N'پروواكس', N'PROWAX'),
        (127, N'BR-0127', N'پروزيس', N'PROZIS'),
        (128, N'BR-0128', N'پرريتي', N'PRRETI'),
        (129, N'BR-0129', N'ريكسسول', N'REXSOL'),
        (130, N'BR-0130', N'ريياده ناهيل', N'RIYADH NAHIL'),
        (131, N'BR-0131', N'روكلي', N'ROKLE')
    ) AS [v] ([BrandID], [BrandCode], [BrandNameAr], [BrandNameEn])
)
INSERT INTO [dbo].[BrandMaster] ([BrandID], [BrandCode], [BrandNameEn], [BrandNameAr], [IsActive])
SELECT [s].[BrandID], [s].[BrandCode], [s].[BrandNameEn], [s].[BrandNameAr], 1
FROM [seed] AS [s]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[BrandMaster] AS [b]
    WHERE [b].[BrandID] = [s].[BrandID] OR [b].[BrandCode] = [s].[BrandCode]
);

SET IDENTITY_INSERT [dbo].[BrandMaster] OFF;

COMMIT TRAN;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;
END CATCH;
