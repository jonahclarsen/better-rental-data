# Better Rental Data

Existing sources of market-rate rental data in Canada, such as the [Rentals.ca National Rent Report](https://rentals.ca/national-rent-report), are not very accurate for some cities, namely those cities with very few (and/or very unrepresentative) listings on Rentals.ca. 

Without accuate market-rate rental data, it's hard to know how effective policies aimed at making rentals more affordable are.

That's why I created this project: to get better data on market-rate rents, and make it available for anyone online, be they potential residents or researchers.

At least in Halifax, most apartments are listed on Facebook Marketplace, so what better source of ground truth than that?

The hardest part of the problem is that Facebook Marketplace listings don't have fine grained enough categories. A listing in the "1-bedroom apartment" category might mean a 1-bedroom apartment, one bedroom in an apartment, or one bed in a bedroom in an apartment. Thus, the Gemini API is used to intelligently categorize listings based on their descriptions into the relevant category.

## Setup

### 1. Start the PostgreSQL Database

```bash
docker-compose up -d
```

This will start:
- PostgreSQL database on port 5432
- pgAdmin web interface on port 5050 (http://localhost:5050)
  - Login: admin@admin.com / password: admin

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Initialize Prisma

```bash
npx prisma migrate dev --name init
```

This creates the database schema based on your Prisma models.

## Usage

### Import Data to PostgreSQL

Import data directly from a Facebook Marketplace JSON file:

```bash
npm run import
```

This will:
- Read the JSON file directly
- Extract useful fields (price, location, description, etc.)
- Add new listings to the database
- Update existing listings
- Track price history for changed listings
- Generate a summary of the import

### View Data with Prisma Studio

```bash
npx prisma studio
```

This opens a web interface (http://localhost:5555) where you can browse and edit your data.

## Database Schema

### Listing
- Stores comprehensive information about each rental listing
- Uses the Facebook listing ID as the primary key
- Tracks price, location, amenities, etc.
- Includes extracted data like bedrooms, bathrooms, square footage

### PriceHistory
- Automatically tracks price changes for each listing over time
- Creates a new entry whenever a listing's price changes

## Analysis

You can use SQL queries to analyze your data:

```sql
-- Average rental price by city
SELECT city, AVG(price) as avg_price 
FROM "Listing" 
GROUP BY city 
ORDER BY avg_price DESC;

-- Average price per bedroom
SELECT bedrooms, AVG(price) as avg_price, COUNT(*) as count
FROM "Listing" 
WHERE bedrooms IS NOT NULL
GROUP BY bedrooms 
ORDER BY bedrooms;

-- Price trends over time
SELECT DATE_TRUNC('week', "recordedAt") as week, 
       AVG(price) as avg_price 
FROM "PriceHistory" 
GROUP BY week 
ORDER BY week;

-- Pet-friendly listings price premium
SELECT 
  CASE WHEN "petFriendly" = true THEN 'Pet-friendly' ELSE 'No pets' END as category,
  AVG(price) as avg_price,
  COUNT(*) as count
FROM "Listing"
WHERE "petFriendly" IS NOT NULL
GROUP BY "petFriendly";
```

## Requirements

- Docker and Docker Compose
- Node.js (v14+)
- npm (Node package manager) 