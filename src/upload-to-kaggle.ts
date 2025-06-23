import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// Check if Kaggle credentials exist
const kaggleConfigPath = join(process.env.HOME || process.env.USERPROFILE || '', '.kaggle', 'kaggle.json');

if (!existsSync(kaggleConfigPath)) {
  console.error('Error: Kaggle credentials not found!');
  console.error('\nTo set up Kaggle:');
  console.error('1. Go to https://www.kaggle.com/account');
  console.error('2. Scroll to "API" section and click "Create New API Token"');
  console.error('3. This will download kaggle.json to your Downloads folder');
  console.error('4. Move it to ~/.kaggle/kaggle.json');
  console.error('5. Run: chmod 600 ~/.kaggle/kaggle.json');
  process.exit(1);
}

// Read username from kaggle.json for dataset ID
const kaggleConfig = JSON.parse(readFileSync(kaggleConfigPath, 'utf8'));
const KAGGLE_USERNAME = kaggleConfig.username;
const DATASET_SLUG = 'better-rental-data';

function createOrUpdateDatasetMetadata() {
  const metadataPath = join('data', 'dataset-metadata.json');
  
  if (!existsSync(metadataPath)) {
    // Create initial metadata
    const metadata = {
      title: "Better Rental Data - Canadian Market Rates",
      id: `${KAGGLE_USERNAME}/${DATASET_SLUG}`,
      licenses: [{ name: "CC0-1.0" }],
      description: "Market-rate rental data from Canadian cities, scraped from Facebook Marketplace. Updated regularly with new listings and price changes.",
      keywords: ["real estate", "housing", "canada", "rentals", "apartments", "market data"]
    };
    
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log('✓ Created dataset metadata');
    return true; // New dataset
  }
  
  return false; // Existing dataset
}

async function uploadToKaggle() {
  try {
    const isNewDataset = createOrUpdateDatasetMetadata();
    
    // Change to data directory for Kaggle CLI
    process.chdir('data');
    
    if (isNewDataset) {
      // Create new dataset
      console.log('Creating new Kaggle dataset...');
      execSync('kaggle datasets create -p . --dir-mode zip', { stdio: 'inherit' });
      console.log(`✓ Dataset created: https://www.kaggle.com/datasets/${KAGGLE_USERNAME}/${DATASET_SLUG}`);
    } else {
      // Update existing dataset
      const versionNotes = `Updated: ${new Date().toISOString().split('T')[0]} - New listings and price updates`;
      console.log('Updating existing Kaggle dataset...');
      execSync(`kaggle datasets version -p . -m "${versionNotes}" --dir-mode zip`, { stdio: 'inherit' });
      console.log(`✓ Dataset updated: https://www.kaggle.com/datasets/${KAGGLE_USERNAME}/${DATASET_SLUG}`);
    }
    
    // Return to original directory
    process.chdir('..');
    
  } catch (error) {
    console.error('Error uploading to Kaggle:', error);
    process.exit(1);
  }
}

// Add summary of what will be uploaded
function showUploadSummary() {
  console.log('\n📊 Upload Summary:');
  console.log(`   Kaggle username: ${KAGGLE_USERNAME}`);
  console.log(`   Dataset: ${KAGGLE_USERNAME}/${DATASET_SLUG}`);
  
  try {
    const files = execSync('find data -name "*.json" -type f | grep -v metadata | wc -l', { encoding: 'utf8' });
    console.log(`   JSON files: ${files.trim()}`);
    
    const size = execSync('du -sh data | cut -f1', { encoding: 'utf8' });
    console.log(`   Total size: ${size.trim()}`);
    
    console.log('\n');
  } catch (error) {
    // Ignore errors in summary
  }
}

if (require.main === module) {
  showUploadSummary();
  uploadToKaggle();
} 