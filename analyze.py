import json
import statistics

def create_categorization_prompt(listings):
    """
    Creates a prompt for AI to categorize listings based on their descriptions.
    
    Args:
        listings: List of listing dictionaries from the JSON file
    
    Returns:
        A formatted prompt string
    """
    # Open a log file for writing errors instead of printing to console
    log_file = open('prompt_errors.log', 'w', encoding='utf-8')
    
    prompt = """Please categorize each of the following rental listings as one of:
- airbnb (or other short term rental, for rent by the night)
if it's not an airbnb/short term rental, then:
- studio apartment (full apartment/suite)
- 1bdr apartment (full apartment/suite)
- 2bdr apartment (full apartment/suite)
- 3bdr apartment (full apartment/suite)
- 4bdr apartment (full apartment/suite)
- bedroom (room in shared apartment)
- bed (sharing a room with someone else)
- other
- unknown (if cannot determine)

Respond with just the category name for each numbered listing, excluding the part in parentheses.

"""
    # Limit to first n listings
    # for i, listing in enumerate(listings, 1):
    for i, listing in enumerate(listings[:120], 1):
        try:
            desc = listing['listing_details']['redacted_description']['text']
            prompt += f"Listing {i}:\n{desc}\n\n"
        except (KeyError, TypeError) as e:
            # Write to log file instead of printing to console
            log_file.write(f"Skipping listing {i} due to missing description\n")
            continue
            
    # Close the log file
    log_file.close()
    return prompt

def analyze_listing_prices(filename):
    """
    Analyzes Facebook Marketplace listing prices from a JSON file.

    Args:
        filename: The path to the JSON file.

    Returns:
        A dictionary containing the average, minimum, maximum, and median
        listing prices, or None if an error occurs.  Prints error
        messages to the console.
    """
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: File not found: {filename}")
        return None
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON format in file: {filename}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None

    prices = []
    count_123 = 0  # Counter for prices containing '123'
    for listing in data:
        try:
            # Extract the price as a float.  Handle potential errors.
            price_str = listing['listing_price']['amount']
            price = float(price_str)
            
            # Skip listings under $600
            if price < 600:
                continue
                
            # Check if '123' appears in the price string
            if '123' in price_str:
                count_123 += 1
                
            prices.append(price)
        except (KeyError, TypeError, ValueError) as e:
            print(f"Skipping listing due to missing or invalid price data: {listing.get('id', 'Unknown ID')}")
            # You could log the specific error and listing ID here, if needed.
            continue  # Skip to the next listing

    if not prices:
        print("No valid prices found in the data.")
        return None

    try:
        average_price = statistics.mean(prices)
        min_price = min(prices)
        max_price = max(prices)
        median_price = statistics.median(prices)

        results = {
            'average': average_price,
            'minimum': min_price,
            'maximum': max_price,
            'median': median_price,
            'count_123': count_123,
        }

        print(f"Price Analysis for {filename}:")
        print(f"  Average Price: {average_price:.2f}")
        print(f"  Minimum Price: {min_price:.2f}")
        print(f"  Maximum Price: {max_price:.2f}")
        print(f"  Median Price: {median_price:.2f}")
        print(f"  Number of prices containing '123': {count_123}")
        print(f"  Total listings (filtered ≥ $600): {len(prices)}")
        
        # Generate and save the categorization prompt to a file
        prompt = create_categorization_prompt(data)
        with open('prompt.txt', 'w', encoding='utf-8') as f:
            f.write(prompt)
        print("\nCategorization prompt has been written to prompt.txt")

        return results

    except statistics.StatisticsError:
        print("Error calculating statistics (likely due to empty price list).")
        return None
    except Exception as e: #catch any other exception
        print(f"Error during statistics: {e}")
        return None


if __name__ == '__main__':
    filename = "data/halifax:1-bedroom-apartments/dataset_Facebook-marketplace-scraper_2025-03-16_22-23-18-811.json"
    analyze_listing_prices(filename)