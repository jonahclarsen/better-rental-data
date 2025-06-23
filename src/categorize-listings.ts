import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Prisma client
const prisma = new PrismaClient();

// Initialize Gemini AI - You'll need to set GEMINI_API_KEY environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Valid categories based on prompt.txt
const VALID_CATEGORIES = [
  'airbnb',
  'studio apartment',
  '1bdr apartment',
  '2bdr apartment', 
  '3bdr apartment',
  '4bdr apartment',
  'bedroom',
  'bed',
  'other',
  'unknown'
];

// Interface for listing data we need
interface ListingForCategorization {
  id: string;
  listingTitle: string | null;
  description: string | null;
  price: any; // Decimal type from Prisma
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  petFriendly: boolean | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
}

// Read the prompt template
async function getPromptTemplate(): Promise<string> {
  const promptPath = path.join(__dirname, '..', 'prompt.txt');
  const promptContent = await fs.promises.readFile(promptPath, 'utf-8');
  return promptContent;
}

// Format listings for the prompt
function formatListingsForPrompt(listings: ListingForCategorization[]): string {
  return listings.map((listing, index) => {
    const parts = [];
    parts.push(`${index + 1}. ${listing.listingTitle || 'Untitled'}`);
    
    if (listing.price) {
      parts.push(`Price: $${listing.price}/month`);
    }
    
    if (listing.bedrooms !== null) {
      parts.push(`Bedrooms: ${listing.bedrooms}`);
    }
    
    if (listing.bathrooms !== null) {
      parts.push(`Bathrooms: ${listing.bathrooms}`);
    }
    
    if (listing.description) {
      // Truncate description to first 200 chars to keep prompt size manageable
      const truncatedDesc = listing.description.substring(0, 200);
      parts.push(`Description: ${truncatedDesc}${listing.description.length > 200 ? '...' : ''}`);
    }
    
    if (listing.amenities.length > 0) {
      parts.push(`Amenities: ${listing.amenities.slice(0, 5).join(', ')}`);
    }
    
    return parts.join(' | ');
  }).join('\n');
}

// Parse and validate AI response
function parseAIResponse(response: string, batchSize: number): string[] {
  const lines = response.trim().split('\n');
  const categories: string[] = [];
  
  for (let i = 0; i < batchSize; i++) {
    const line = lines[i];
    if (!line) {
      throw new Error(`Missing response for listing ${i + 1}. Expected ${batchSize} responses but got ${lines.length}`);
    }
    
    // Extract category from line (handle formats like "1. studio apartment" or just "studio apartment")
    const match = line.match(/^\d+\.\s*(.+)$/) || line.match(/^(.+)$/);
    if (!match) {
      throw new Error(`Invalid response format for listing ${i + 1}: "${line}"`);
    }
    
    const category = match[1].trim().toLowerCase();
    
    // Validate category
    if (!VALID_CATEGORIES.includes(category)) {
      throw new Error(`Invalid category "${category}" for listing ${i + 1}. Valid categories are: ${VALID_CATEGORIES.join(', ')}`);
    }
    
    categories.push(category);
  }
  
  if (categories.length !== batchSize) {
    throw new Error(`Expected ${batchSize} categories but parsed ${categories.length}`);
  }
  
  return categories;
}

// Process a batch of listings
async function processBatch(listings: ListingForCategorization[], promptTemplate: string): Promise<Map<string, string>> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  
  // Format listings for the prompt
  const formattedListings = formatListingsForPrompt(listings);
  
  // Replace placeholder in template with actual listings
  const prompt = promptTemplate.replace('[insert listings, numbered]', formattedListings);
  
  console.log(`Sending batch of ${listings.length} listings to Gemini...`);
  
  try {
    // Generate content
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    console.log('Received response:', response);
    
    // Parse and validate response
    const categories = parseAIResponse(response, listings.length);
    
    // Create map of listing ID to category
    const categoryMap = new Map<string, string>();
    listings.forEach((listing, index) => {
      categoryMap.set(listing.id, categories[index]);
    });
    
    return categoryMap;
  } catch (error) {
    console.error('Error processing batch:', error);
    throw error;
  }
}

// Main function
async function categorizeAllListings() {
  try {
    // Check for API key
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set. Set it by running: export GEMINI_API_KEY="your-api-key-here"');
    }
    
    // Get prompt template
    const promptTemplate = await getPromptTemplate();
    
    // Get all listings that need categorization
    const listings = await prisma.listing.findMany({
      where: {
        OR: [
          { ai_category_v1: '' },
          { ai_category_v1: null }
        ]
      },
      select: {
        id: true,
        listingTitle: true,
        description: true,
        price: true,
        bedrooms: true,
        bathrooms: true,
        amenities: true,
        petFriendly: true,
        streetAddress: true,
        city: true,
        state: true
      }
    });
    
    console.log(`Found ${listings.length} listings to categorize`);
    
    if (listings.length === 0) {
      console.log('No listings need categorization');
      return;
    }
    
    // Process in batches of 50
    const batchSize = 50;
    let totalProcessed = 0;
    let totalErrors = 0;
    
    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, Math.min(i + batchSize, listings.length));
      console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(listings.length / batchSize)}`);
      
      try {
        // Process batch
        const categoryMap = await processBatch(batch, promptTemplate);
        
        // Update database
        for (const [listingId, category] of categoryMap.entries()) {
          await prisma.listing.update({
            where: { id: listingId },
            data: { ai_category_v1: category }
          });
          totalProcessed++;
        }
        
        console.log(`Successfully categorized ${batch.length} listings`);
        
        // Add a small delay between batches to avoid rate limiting
        if (i + batchSize < listings.length) {
          console.log('Waiting 2 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`Error processing batch starting at index ${i}:`, error);
        totalErrors += batch.length;
        
        // Continue with next batch instead of stopping
        continue;
      }
    }
    
    console.log(`\n===== CATEGORIZATION COMPLETE =====`);
    console.log(`Total listings processed: ${totalProcessed}`);
    console.log(`Total errors: ${totalErrors}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
categorizeAllListings()
  .then(() => {
    console.log('Categorization script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  }); 