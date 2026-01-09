#!/usr/bin/env python3
"""
test_client.py - Example usage of the Text Processing API
"""

import requests
import json

API_BASE = 'http://localhost:5000'

def process_text():
    """Example 1: Process text directly"""
    print("=== Example 1: Process Text ===")
    
    response = requests.post(f'{API_BASE}/api/process', json={
        'text': '''
        This is a sample text. It has multiple sentences! 
        Each sentence will be analyzed. The API will count words and calculate statistics.
        Python makes this very simple and efficient. Natural language processing is fascinating.
        '''
    })
    
    result = response.json()
    print(f"Status: {response.status_code}")
    print(f"Word Count: {result['statistics']['word_count']}")
    print(f"Sentence Count: {result['statistics']['sentence_count']}")
    print(f"Cached: {result['cached']}")
    print(f"Cache Key: {result.get('cache_key', 'N/A')[:16]}...")
    print(f"Top 5 Words: {result['top_words'][:5]}")
    print()
    
    return result.get('cache_key')

def process_text_cached(cache_key):
    """Example 2: Process same text (should be cached)"""
    print("=== Example 2: Process Same Text (should be cached) ===")
    
    response = requests.post(f'{API_BASE}/api/process', json={
        'text': '''
        This is a sample text. It has multiple sentences! 
        Each sentence will be analyzed. The API will count words and calculate statistics.
        Python makes this very simple and efficient. Natural language processing is fascinating.
        '''
    })
    
    result = response.json()
    print(f"Status: {response.status_code}")
    print(f"Cached: {result['cached']}")
    print()

def upload_file():
    """Example 3: Upload a file"""
    print("=== Example 3: Upload File ===")
    
    # Create a sample file
    with open('sample.txt', 'w') as f:
        f.write('This is file content. It will be processed the same way as text input. ')
        f.write('Files can contain large amounts of text. ')
        f.write('The API handles them efficiently.')
    
    with open('sample.txt', 'rb') as f:
        files = {'file': ('sample.txt', f, 'text/plain')}
        response = requests.post(f'{API_BASE}/api/process/file', files=files)
    
    result = response.json()
    print(f"Status: {response.status_code}")
    print(f"Filename: {result.get('filename')}")
    print(f"Word Count: {result['statistics']['word_count']}")
    print(f"Cache Key: {result.get('cache_key', 'N/A')[:16]}...")
    print()
    
    return result.get('cache_key')

def get_cached(cache_key):
    """Example 4: Retrieve cached result"""
    print("=== Example 4: Retrieve Cached Result ===")
    
    response = requests.get(f'{API_BASE}/api/cached/{cache_key}')
    
    if response.status_code == 200:
        result = response.json()
        print(f"Status: {response.status_code}")
        print(f"Word Count: {result['statistics']['word_count']}")
        print("Successfully retrieved from cache!")
    else:
        print(f"Status: {response.status_code}")
        print(f"Error: {response.json()}")
    print()

def delete_cached(cache_key):
    """Example 5: Delete cached entry"""
    print("=== Example 5: Delete Cached Entry ===")
    
    response = requests.delete(f'{API_BASE}/api/cached/{cache_key}')
    print(f"Status: {response.status_code}")
    print(f"Message: {response.json()}")
    print()

def health_check():
    """Example 6: Health check"""
    print("=== Example 6: Health Check ===")
    
    response = requests.get(f'{API_BASE}/health')
    result = response.json()
    print(f"Status: {result['status']}")
    print(f"Cache Size: {result['cache_size']}")
    print(f"Timestamp: {result['timestamp']}")
    print()

def run_all_examples():
    """Run all examples in sequence"""
    try:
        # Check if server is running
        health_check()
        
        # Process text
        cache_key1 = process_text()
        
        # Process same text (cached)
        process_text_cached(cache_key1)
        
        # Upload file
        cache_key2 = upload_file()
        
        # Get cached result
        if cache_key1:
            get_cached(cache_key1)
        
        # Delete cached entry
        if cache_key2:
            delete_cached(cache_key2)
        
        # Final health check
        health_check()
        
        print("✓ All examples completed successfully!")
        
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to the API server.")
        print("Make sure the server is running: python app.py")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    run_all_examples()