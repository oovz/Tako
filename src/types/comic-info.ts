/**
 * ComicInfo metadata aligned with the Anansi Project ComicInfo v2.0 schema and field documentation.
 * Ref: https://anansi-project.github.io/docs/comicinfo/schemas/v2.0
 * Ref: https://anansi-project.github.io/docs/comicinfo/documentation
 *
 * Populate these fields only from authoritative site/API data. Do not infer chapter- or
 * page-specific values from weak heuristics when the source does not expose them reliably.
 */
export interface ComicInfoV2 {
  // Basic Information (1.0 ✓ | 2.0 ✓)
  Title?: string;        // Title of the book / chapter / issue
  Series?: string;       // Title of the parent series
  Number?: string;       // Number of the book in the series (string to preserve decimals like "15.5")
  Count?: number;        // Total number of books in the series
  Volume?: number;       // Volume identifier for the series

  // Alternative Series Information (1.0 ✓ | 2.0 ✓)
  AlternateSeries?: string;     // Alternate crossover / reading-order series name
  AlternateNumber?: string;     // Number within the alternate series / reading order
  AlternateCount?: number;      // Total count within the alternate series / reading order

  // Content Information (1.0 ✓ | 2.0 ✓)
  Summary?: string;      // Description or summary of the book
  Notes?: string;        // Free-text notes, commonly generator/app notes

  // Publication Date (1.0 ✓ | 2.0 ✓) - Day field added in 2.0
  Year?: number;         // Publication / release year
  Month?: number;        // Publication / release month (1-12)
  Day?: number;          // Publication / release day (1-31)

  // Creator Information (1.0 ✓ | 2.0 ✓)
  Writer?: string;       // Scenario / story writer(s), comma-separated when multiple
  Penciller?: string;    // Pencil artist(s), comma-separated when multiple
  Inker?: string;        // Ink artist(s), comma-separated when multiple
  Colorist?: string;     // Color artist(s), comma-separated when multiple
  Letterer?: string;     // Letterer(s), comma-separated when multiple
  CoverArtist?: string;  // Cover artist(s), comma-separated when multiple
  Editor?: string;       // Editor(s), comma-separated when multiple

  // Publication Information (1.0 ✓ | 2.0 ✓)
  Publisher?: string;    // Organization responsible for publishing / issuing the work
  Imprint?: string;      // Imprint under the parent publisher
  Genre?: string;        // Genre(s), comma-separated when multiple
  Web?: string;          // Reference URL(s), space-separated when multiple

  // Content Rating and Audience (1.0 ✓ | 2.0 ✓)
  AgeRating?: string;    // Age rating (e.g., "Teen", "Mature")

  // Story Organization (2.0 only)
  StoryArc?: string;     // Story arc name(s), comma-separated when multiple
  SeriesGroup?: string;  // Group / collection names the series belongs to, comma-separated

  // Ratings & Reviews (2.0 only)
  CommunityRating?: number; // Community rating in the 0.0-5.0 range
  Review?: string;       // Review text

  // Scan Information (2.0 only)
  ScanInformation?: string; // Free-text scanner / scanlation group information

  // Visual Information (2.0 only)
  BlackAndWhite?: 'Yes' | 'No' | 'Unknown'; // Whether the work is black and white
  MainCharacterOrTeam?: string; // Single primary character or team

  // Technical Information
  PageCount?: number;    // Number of pages in the book
  LanguageISO?: string;  // Recommended to store an IETF BCP 47 language tag
  Format?: string;       // Original publication / presentation format (e.g. Web, Digital, HC)

  // Page Information (1.0 ✓ | 2.0 ✓)
  Pages?: ComicPageInfo[];

  // Status and Reading Information (1.0 ✓ | 2.0 ✓)
  Manga?: 'Yes' | 'No' | 'YesAndRightToLeft'; // Manga marker; YesAndRightToLeft implies RTL reading order

  // Additional cataloging fields used by ComicInfo-aware readers
  Characters?: string;   // Characters present in the book, comma-separated when multiple
  Teams?: string;        // Teams / groups present in the book, comma-separated when multiple
  Locations?: string;    // Locations mentioned in the book, comma-separated when multiple
}

// ComicInfo page information structure.
// Ref: https://anansi-project.github.io/docs/comicinfo/documentation#pages--comicpageinfo
export interface ComicPageInfo {
  Image: number; // Zero-based page index inside the archive
  Type?: 'FrontCover' | 'InnerCover' | 'Roundup' | 'Story' | 'Advertisement' | 'Editorial' | 'Letters' | 'Preview' | 'BackCover' | 'Other' | 'Deleted';
  DoublePage?: boolean; // Whether the page is a double spread
  ImageSize?: number; // File size in bytes
  Key?: string; // Reserved / poorly documented key field in ecosystem usage
  Bookmark?: string; // ComicRack bookmark label
  ImageWidth?: number; // Width in pixels
  ImageHeight?: number; // Height in pixels
}

// ComicInfo version compatibility definitions - P1-3: Only v2.0 supported
export interface ComicInfoVersionSupport {
  version: '2.0';
  supportedFields: (keyof ComicInfoV2)[];
  requiredFields: (keyof ComicInfoV2)[];
  enumValues: {
    BlackAndWhite: string[];
    Manga: string[];
  };
}
