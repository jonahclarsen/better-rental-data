import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Interface for our parsed JSON data
interface ListingData {
  id: string;
  listingTitle?: string;
  price?: number;
  city?: string;
  state?: string;
  country?: string;
  imageUrl?: string;
  listingUrl?: string;
  datetime?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  bedrooms?: number;
  bathrooms?: number;
}

// Statistics interface for tracking import results
interface ImportStats {
  newListings: number;
  updatedListings: number;
  skippedListings: number;
  totalProcessed: number;
  errors: number;
}

// Initialize the Prisma client
const prisma = new PrismaClient();

/**
 * Recursively finds all JSON files in a directory and its subdirectories
 * @param directoryPath The directory to search in
 * @returns Array of absolute paths to JSON files
 */
async function findJsonFiles(directoryPath: string): Promise<string[]> {
  const jsonFiles: string[] = [];
  
  try {
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);
      
      if (entry.isDirectory()) {
        const subDirFiles = await findJsonFiles(fullPath);
        jsonFiles.push(...subDirFiles);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        jsonFiles.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error searching directory ${directoryPath}:`, error);
  }
  
  return jsonFiles;
}

/**
 * Imports listings from a JSON file into the database
 * @param filePath Path to the JSON file containing listings
 * @returns Statistics about the import process
 */
async function importListings(filePath: string): Promise<ImportStats> {
  // Initialize statistics
  const stats: ImportStats = {
    newListings: 0,
    updatedListings: 0,
    skippedListings: 0,
    totalProcessed: 0,
    errors: 0
  };
  
  try {
    // Read and parse the JSON file
    const fileContent = await fs.promises.readFile(filePath, 'utf-8');
    const listings = JSON.parse(fileContent);
    
    console.log(`Processing ${listings.length} listings from ${path.basename(filePath)}...`);
    
    // Process each listing
    for (const item of listings) {
      try {
        stats.totalProcessed++;
        
        // Parse price as cents to avoid floating point issues
        let priceInCents = 0;
        if (item.listing_price?.amount) {
          // Parse as float first, then convert to cents as integer
          const parsedPrice = parseFloat(item.listing_price.amount);
          if (!isNaN(parsedPrice)) {
            // Convert to cents by multiplying by 100 and rounding to avoid floating point errors
            priceInCents = Math.round(parsedPrice * 100);
          }
        }
        
        // Extract location details
        const city = item.location?.reverse_geocode?.city || 
                    item.listing_details?.location?.reverse_geocode_detailed?.city || 
                    '';
        
        const state = item.location?.reverse_geocode?.state || 
                     item.listing_details?.location?.reverse_geocode_detailed?.state || 
                     '';
                     
        const postalCode = item.listing_details?.location?.reverse_geocode_detailed?.postal_code || '';
        
        // Extract street address
        let streetAddress = '';
        if (item.listing_details?.home_address?.street) {
          streetAddress = item.listing_details.home_address.street;
        } else if (item.custom_sub_titles_with_rendering_flags) {
          // Sometimes address is in custom subtitles
          for (const subtitle of item.custom_sub_titles_with_rendering_flags) {
            if (subtitle.subtitle && !subtitle.subtitle.includes(city) && !subtitle.subtitle.includes(state)) {
              streetAddress = subtitle.subtitle;
              break;
            }
          }
        }
        
        // Extract latitude and longitude
        const latitude = item.listing_details?.location?.latitude || null;
        const longitude = item.listing_details?.location?.longitude || null;
        
        // Extract bedroom and bathroom counts
        let bedrooms = extractBedroomCount(item);
        let bathrooms = extractBathroomCount(item);
        
        // Try to extract from unit_room_info if available
        if (item.listing_details?.unit_room_info && !bedrooms && !bathrooms) {
          const roomInfo = item.listing_details.unit_room_info;
          const bedroomMatch = roomInfo.match(/(\d+)\s*bed/i);
          const bathroomMatch = roomInfo.match(/(\d+)\s*bath/i);
          
          if (bedroomMatch) bedrooms = parseInt(bedroomMatch[1]);
          if (bathroomMatch) bathrooms = parseInt(bathroomMatch[1]);
        }
        
        // Pet friendly
        let petFriendly = false;
        if (item.listing_details?.pdp_display_sections) {
          for (const section of item.listing_details.pdp_display_sections) {
            if (section.pdp_fields) {
              for (const field of section.pdp_fields) {
                if (field.display_label && field.display_label.toLowerCase().includes('pet') ||
                    field.display_label && field.display_label.toLowerCase().includes('dog') ||
                    field.display_label && field.display_label.toLowerCase().includes('cat')) {
                  petFriendly = true;
                  break;
                }
              }
            }
          }
        }
        
        // Check description for pet friendly mentions
        if (!petFriendly && item.listing_details?.redacted_description?.text) {
          const descText = item.listing_details.redacted_description.text.toLowerCase();
          if (descText.includes('pet friendly') || 
              descText.includes('pets allowed') || 
              descText.includes('pet-friendly') ||
              descText.includes('dogs allowed') ||
              descText.includes('cats allowed')) {
            petFriendly = true;
          }
        }
        
        // Available date
        let availableDate = null;
        if (item.listing_details?.pdp_display_sections) {
          for (const section of item.listing_details.pdp_display_sections) {
            if (section.pdp_fields) {
              for (const field of section.pdp_fields) {
                if (field.display_label && field.display_label.includes('Available')) {
                  const dateMatch = field.display_label.match(/Available\s+(\d{4}\/\d{2}\/\d{2})/i);
                  if (dateMatch) {
                    availableDate = new Date(dateMatch[1]);
                  } else if (field.display_label.toLowerCase().includes('now')) {
                    availableDate = new Date();
                  }
                  break;
                }
              }
            }
          }
        }
        
        // Extract amenities
        const amenities: string[] = [];
        if (item.listing_details?.pdp_display_sections) {
          for (const section of item.listing_details.pdp_display_sections) {
            if (section.pdp_fields) {
              for (const field of section.pdp_fields) {
                if (field.display_label && 
                    !field.display_label.includes('bed') && 
                    !field.display_label.includes('bath') &&
                    !field.display_label.includes('Available')) {
                  amenities.push(field.display_label);
                }
              }
            }
          }
        }
        
        // Image URL
        const imageUrl = item.primary_listing_photo?.image?.uri || 
                         item.listing_details?.listing_photos?.[0]?.image?.uri || 
                         '';
        
        // Extract data with proper fallbacks for missing fields
        const listing: ListingData = {
          id: item.id,
          listingTitle: item.marketplace_listing_title || item.custom_title || '',
          price: priceInCents / 100,
          city,
          state,
          country: '',
          imageUrl,
          listingUrl: '',
          datetime: item.creation_time || '',
          description: item.listing_details?.redacted_description?.text || '',
          latitude,
          longitude,
          bedrooms,
          bathrooms
        };
        
        // Skip listings without an ID
        if (!listing.id) {
          stats.skippedListings++;
          continue;
        }
        
        // Check if the listing already exists
        const existingListing = await prisma.listing.findUnique({
          where: { id: listing.id }
        });
        
        // Prepare database record
        const dbData: any = {
          id: listing.id,
          // Use string representation for price to avoid precision loss
          price: (priceInCents / 100).toFixed(2),
        };
        
        // Add optional fields if they exist
        if (listing.listingTitle) dbData.listingTitle = listing.listingTitle;
        if (city) dbData.city = city;
        if (state) dbData.state = state;
        if (postalCode) dbData.postalCode = postalCode;
        if (streetAddress) dbData.streetAddress = streetAddress;
        if (listing.description) dbData.description = listing.description;
        if (latitude) dbData.latitude = latitude.toString();
        if (longitude) dbData.longitude = longitude.toString();
        if (bedrooms) dbData.bedrooms = bedrooms;
        if (bathrooms) dbData.bathrooms = bathrooms;
        if (amenities.length > 0) dbData.amenities = amenities;
        if (petFriendly !== null) dbData.petFriendly = petFriendly;
        if (availableDate) dbData.availableDate = availableDate;
        if (imageUrl) dbData.imageUrl = imageUrl;
        if (item.creation_time) dbData.listedDate = new Date(item.creation_time);
        
        // AI categorization based on description
        dbData.ai_category_v1 = determineListingCategory(listing.description, bedrooms);
        
        // Log price changes for existing listings
        if (existingListing) {
          const existingPrice = existingListing.price;
          const newPrice = parseFloat(dbData.price);
          
          // Convert both to strings with 2 decimal places for comparison
          const existingPriceStr = existingPrice.toString();
          const newPriceStr = newPrice.toFixed(2);
          
          if (existingPriceStr !== newPriceStr) {
            console.log(`Price change for listing ${listing.id}: $${existingPriceStr} → $${newPriceStr}`);
          }
          
          // Update existing listing
          await prisma.listing.update({
            where: { id: listing.id },
            data: dbData
          });
          stats.updatedListings++;
        } else {
          // Create new listing
          await prisma.listing.create({
            data: dbData
          });
          stats.newListings++;
        }
      } catch (error) {
        stats.errors++;
        console.error(`Error processing listing ${item.id || 'unknown'}:`, error);
      }
    }
    
    return stats;
    
  } catch (error) {
    console.error(`Error importing file ${filePath}:`, error);
    stats.errors++;
    return stats;
  }
}

/**
 * Extract bedroom count from listing data
 */
function extractBedroomCount(item: any): number | undefined {
  try {
    // Check different possible places where bedroom info might be stored
    if (item.listing_title?.text && item.listing_title.text.includes('bedroom')) {
      const match = item.listing_title.text.match(/(\d+)\s*bedroom/i);
      if (match) return parseInt(match[1]);
    }
    
    if (item.description && item.description.includes('bedroom')) {
      const match = item.description.match(/(\d+)\s*bedroom/i);
      if (match) return parseInt(match[1]);
    }
    
    // Try to find in structured data if available
    return item.bedrooms || undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * Extract bathroom count from listing data
 */
function extractBathroomCount(item: any): number | undefined {
  try {
    // Check different possible places where bathroom info might be stored
    if (item.listing_title?.text && item.listing_title.text.includes('bathroom')) {
      const match = item.listing_title.text.match(/(\d+)\s*bathroom/i);
      if (match) return parseInt(match[1]);
    }
    
    if (item.description && item.description.includes('bathroom')) {
      const match = item.description.match(/(\d+)\s*bathroom/i);
      if (match) return parseInt(match[1]);
    }
    
    // Try to find in structured data if available
    return item.bathrooms || undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * Determine the category of listing based on description and bedroom count
 */
function determineListingCategory(description: string | undefined, bedrooms?: number): string {
  if (!description) return 'unknown';
  
  const desc = description.toLowerCase();
  
  // Check for Airbnb or short-term rental indicators
  if (desc.includes('airbnb') || 
      desc.includes('short term') || 
      desc.includes('short-term') ||
      desc.includes('nightly') ||
      desc.includes('per night') ||
      desc.includes('vacation rental')) {
    return 'airbnb';
  }
  
  // Determine based on bedroom count and description
  if (desc.includes('studio')) {
    return 'studio apartment';
  } else if (desc.includes('room for rent') || 
             desc.includes('roommate') || 
             desc.includes('shared apartment') ||
             desc.includes('shared kitchen') ||
             desc.includes('shared bathroom')) {
    return 'bedroom';
  } else if (desc.includes('shared room') || desc.includes('shared bedroom')) {
    return 'bed';
  } else if (bedrooms) {
    return `${bedrooms}bdr apartment`;
  }
  
  // Default based on keyword matching
  if (desc.includes('1 bedroom') || desc.includes('1-bedroom') || desc.includes('one bedroom')) {
    return '1bdr apartment';
  } else if (desc.includes('2 bedroom') || desc.includes('2-bedroom') || desc.includes('two bedroom')) {
    return '2bdr apartment';
  } else if (desc.includes('3 bedroom') || desc.includes('3-bedroom') || desc.includes('three bedroom')) {
    return '3bdr apartment';
  } else if (desc.includes('4 bedroom') || desc.includes('4-bedroom') || desc.includes('four bedroom')) {
    return '4bdr apartment';
  }
  
  return 'unknown';
}

/**
 * Main function to process all JSON files in the data directory
 */
async function processAllFiles() {
  const dataDir = path.resolve(__dirname, '../data');
  console.log(`Searching for JSON files in ${dataDir}...`);
  
  // Find all JSON files
  const jsonFiles = await findJsonFiles(dataDir);
  console.log(`Found ${jsonFiles.length} JSON files to process.`);
  
  // Initialize total statistics
  const totalStats: ImportStats = {
    newListings: 0,
    updatedListings: 0,
    skippedListings: 0,
    totalProcessed: 0,
    errors: 0
  };
  
  // Process each file
  for (const filePath of jsonFiles) {
    console.log(`\nProcessing file: ${path.basename(filePath)}`);
    const stats = await importListings(filePath);
    
    // Add to total stats
    totalStats.newListings += stats.newListings;
    totalStats.updatedListings += stats.updatedListings;
    totalStats.skippedListings += stats.skippedListings;
    totalStats.totalProcessed += stats.totalProcessed;
    totalStats.errors += stats.errors;
    
    // Print file stats
    console.log(`File statistics:
  - New listings: ${stats.newListings}
  - Updated listings: ${stats.updatedListings}
  - Skipped listings: ${stats.skippedListings}
  - Total processed: ${stats.totalProcessed}
  - Errors: ${stats.errors}`);
  }
  
  // Print total stats
  console.log(`\n===== TOTAL IMPORT STATISTICS =====
- Total new listings: ${totalStats.newListings}
- Total updated listings (including duplicates between files): ${totalStats.updatedListings}
- Total skipped listings: ${totalStats.skippedListings}
- Total listings processed: ${totalStats.totalProcessed}
- Total errors: ${totalStats.errors}`);
}

// Execute the main function
processAllFiles()
  .then(() => {
    console.log('Import process completed.');
    prisma.$disconnect();
  })
  .catch((error) => {
    console.error('Error during import process:', error);
    prisma.$disconnect();
    process.exit(1);
  }); 