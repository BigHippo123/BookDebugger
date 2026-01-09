from flask import Flask, request, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.utils import secure_filename
import hashlib
import time
import re
from collections import Counter
from datetime import datetime, timedelta
import nltk
from nltk.tokenize import word_tokenize, sent_tokenize
from nltk.corpus import stopwords
import numpy as np
import gensim.downloader as api
import faiss
from flask_cors import CORS

app = Flask(__name__)
# Allow your frontend to make requests
CORS(app, resources={
    r"/*": {
        "origins": [
            "http://localhost:3001",
            "https://bookdebugger.onrender.com"
        ],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True
    }
})
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB limit

# Download required NLTK data
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')
    
try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

# Load pre-trained Word2Vec model (using smaller model for faster loading)
# Options: 'word2vec-google-news-300', 'glove-wiki-gigaword-100', 'glove-twitter-25'
print("Loading Word2Vec model... (this may take a minute on first run)")
try:
    word2vec_model = api.load('glove-wiki-gigaword-100')  # 100-dim vectors, faster
    print("Word2Vec model loaded successfully!")
except Exception as e:
    print(f"Warning: Could not load Word2Vec model: {e}")
    word2vec_model = None

# Rate limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["100 per 15 minutes"]
)

# In-memory cache with TTL
cache = {}
CACHE_TTL = 3600  # 1 hour in seconds

# Allowed file extensions
ALLOWED_EXTENSIONS = {'txt', 'text', 'log', 'md', 'json', 'csv'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def generate_cache_key(text, options=None):
    """Generate SHA-256 hash for cache key"""
    hash_input = text + str(options if options else {})
    return hashlib.sha256(hash_input.encode('utf-8')).hexdigest()

def clean_expired_cache():
    """Remove expired cache entries"""
    current_time = time.time()
    expired_keys = [key for key, value in cache.items() 
                    if current_time > value['expires_at']]
    for key in expired_keys:
        del cache[key]

def sanitize_text(text):
    """Basic sanitization to remove potentially dangerous characters"""
    # Remove HTML-like tags
    text = re.sub(r'<[^>]+>', '', text)
    return text

def get_word_embedding(word):
    """Get word embedding vector for a word"""
    if word2vec_model is None:
        return None
    
    try:
        # Word2Vec models are case-sensitive, try lowercase first
        if word.lower() in word2vec_model:
            return word2vec_model[word.lower()].tolist()
        elif word in word2vec_model:
            return word2vec_model[word].tolist()
        else:
            return None
    except:
        return None

def process_text(text, include_embeddings=True):
    """Process text using NLTK and calculate statistics with embeddings"""
    # Sanitize input
    sanitized = sanitize_text(text)
    
    # Use NLTK to tokenize sentences
    sentences = sent_tokenize(sanitized)
    
    # Use NLTK to tokenize words
    words = word_tokenize(sanitized.lower())
    
    # Filter to only alphabetic words
    words = [word for word in words if word.isalpha()]
    
    # Calculate statistics
    word_count = len(words)
    sentence_count = len(sentences)
    avg_words_per_sentence = round(word_count / sentence_count, 2) if sentence_count > 0 else 0
    
    # Word frequency dictionary
    word_freq = Counter(words)
    
    # Character count (excluding spaces)
    char_count = len(re.sub(r'\s', '', sanitized))
    
    # Unique words
    unique_word_count = len(set(words))
    
    # Average word length
    avg_word_length = round(sum(len(word) for word in words) / word_count, 2) if word_count > 0 else 0
    
    # Get stopwords for filtering
    stop_words = set(stopwords.words('english'))
    content_words = [word for word in words if word not in stop_words]
    
    # Top words with their counts
    top_words = [ {'word': word, 'count': count}
                 for word, count in word_freq.most_common(100) if word in content_words]

    # Build word dictionary with embeddings
    word_dictionary = {}
    for word, count in word_freq.items():
        word_entry = {
            'count': count,
            'frequency': round(count / word_count, 4) if word_count > 0 else 0,
            'is_stopword': word in stop_words
        }
        
        if include_embeddings:
            embedding = get_word_embedding(word)
            if embedding is not None:
                word_entry['embedding'] = embedding
                word_entry['embedding_dim'] = len(embedding)
            else:
                word_entry['embedding'] = None
                word_entry['embedding_available'] = False
        
        word_dictionary[word] = word_entry
    
    # Calculate average embedding for the document (only from words with embeddings)
    document_embedding = None
    if include_embeddings and word2vec_model is not None:
        embeddings = []
        words_list = []
        for word in content_words:  # Use content words only
            emb = get_word_embedding(word)
            if emb is not None:
                embeddings.append(emb)
                words_list.append(word)
        
        if embeddings:
            document_embedding = np.mean(embeddings, axis=0).tolist()
    
    # Calculate nearest neighbrs to each word in the document
    print(np.array(embeddings).shape)
    n = 10
    index = faiss.IndexFlatL2(word2vec_model.vector_size)
    index.add(np.array(embeddings).astype('float32'))
    D, I = index.search(np.array(embeddings).astype('float32'), n)  # Top n nearest neighbors

    words_neighbors = {}
    for i, word in enumerate(words_list):
        neighbors = []
        for j in range(1, n):  # Skip the first one (itself)
            neighbor_idx = I[i][j]
            neighbor_word = words_list[neighbor_idx]
            neighbors.append({
                'word': neighbor_word,
                'distance': float(D[i][j])
            })
        words_neighbors[word] = neighbors


    result = {
        'statistics': {
            'word_count': word_count,
            'unique_word_count': unique_word_count,
            'sentence_count': sentence_count,
            'character_count': char_count,
            'avg_words_per_sentence': avg_words_per_sentence,
            'avg_word_length': avg_word_length,
            'content_word_count': len(content_words),
            'stopword_count': word_count - len(content_words)
        },
        'top_words': top_words,
        'sentences': sentences,
        'word_dictionary': word_dictionary,
        'words_neighbors': words_neighbors
    }
    
    if document_embedding is not None:
        result['document_embedding'] = document_embedding
        result['embedding_coverage'] = round(len([w for w in content_words if get_word_embedding(w) is not None]) / len(content_words), 2) if content_words else 0
    
    return result

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    clean_expired_cache()
    return jsonify({
        'status': 'ok',
        'cache_size': len(cache),
        'word2vec_loaded': word2vec_model is not None,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/process', methods=['POST'])
@limiter.limit("50 per minute")
def process_text_endpoint():
    """Process text from JSON body"""
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({'error': 'Text is required'}), 400
        
        text = data['text']
        
        if not isinstance(text, str):
            return jsonify({'error': 'Text must be a string'}), 400
        
        if len(text) > 5 * 1024 * 1024:  # 5MB text limit
            return jsonify({'error': 'Text too large. Maximum 5MB'}), 400
        
        if len(text.strip()) == 0:
            return jsonify({'error': 'Text cannot be empty'}), 400
        
        options = data.get('options', {})
        include_embeddings = options.get('include_embeddings', True)
        
        # Check cache
        cache_key = generate_cache_key(text, options)
        clean_expired_cache()
        
        if cache_key in cache and time.time() < cache[cache_key]['expires_at']:
            return jsonify({
                **cache[cache_key]['data'],
                'cached': True
            })
        
        # Process text
        result = process_text(text, include_embeddings=include_embeddings)
        
        # Store in cache
        cache[cache_key] = {
            'data': result,
            'expires_at': time.time() + CACHE_TTL
        }
        
        return jsonify({
            **result,
            'cached': False,
            'cache_key': cache_key
        })
    
    except Exception as e:
        app.logger.error(f'Processing error: {str(e)}')
        return jsonify({'error': f'Failed to process text: {str(e)}'}), 500

@app.route('/api/process/file', methods=['POST'])
@limiter.limit("20 per minute")
def process_file_endpoint():
    """Process uploaded text file"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': f'File type not allowed. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
        
        # Read file content
        try:
            text = file.read().decode('utf-8')
        except UnicodeDecodeError:
            return jsonify({'error': 'File must be valid UTF-8 text'}), 400
        
        if len(text) > 5 * 1024 * 1024:
            return jsonify({'error': 'File too large. Maximum 5MB'}), 400
        
        options = {}
        if 'options' in request.form:
            import json
            options = json.loads(request.form['options'])
        
        include_embeddings = options.get('include_embeddings', True)
        
        # Check cache
        cache_key = generate_cache_key(text, options)
        clean_expired_cache()
        
        if cache_key in cache and time.time() < cache[cache_key]['expires_at']:
            return jsonify({
                **cache[cache_key]['data'],
                'cached': True,
                'filename': secure_filename(file.filename)
            })
        
        # Process text
        result = process_text(text, include_embeddings=include_embeddings)
        
        # Store in cache
        cache[cache_key] = {
            'data': result,
            'expires_at': time.time() + CACHE_TTL
        }
        
        return jsonify({
            **result,
            'cached': False,
            'cache_key': cache_key,
            'filename': secure_filename(file.filename)
        })
    
    except Exception as e:
        app.logger.error(f'File processing error: {str(e)}')
        return jsonify({'error': f'Failed to process file: {str(e)}'}), 500

@app.route('/api/word/<word>', methods=['GET'])
def get_word_info(word):
    """Get embedding and information for a specific word"""
    word = word.lower()
    embedding = get_word_embedding(word)
    
    if embedding is None:
        return jsonify({
            'word': word,
            'embedding_available': False,
            'message': 'No embedding found for this word'
        })
    
    return jsonify({
        'word': word,
        'embedding': embedding,
        'embedding_dim': len(embedding),
        'embedding_available': True
    })

@app.route('/api/similarity', methods=['POST'])
def word_similarity():
    """Calculate similarity between two words using embeddings"""
    try:
        data = request.get_json()
        word1 = data.get('word1', '').lower()
        word2 = data.get('word2', '').lower()
        
        if not word1 or not word2:
            return jsonify({'error': 'Both word1 and word2 are required'}), 400
        
        if word2vec_model is None:
            return jsonify({'error': 'Word2Vec model not loaded'}), 503
        
        try:
            similarity = word2vec_model.similarity(word1, word2)
            return jsonify({
                'word1': word1,
                'word2': word2,
                'similarity': float(similarity)
            })
        except KeyError as e:
            return jsonify({'error': f'Word not in vocabulary: {str(e)}'}), 404
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/cached/<cache_key>', methods=['GET'])
def get_cached(cache_key):
    """Retrieve cached result by key"""
    clean_expired_cache()
    
    if cache_key not in cache:
        return jsonify({'error': 'Cache entry not found or expired'}), 404
    
    if time.time() >= cache[cache_key]['expires_at']:
        del cache[cache_key]
        return jsonify({'error': 'Cache entry expired'}), 404
    
    return jsonify(cache[cache_key]['data'])

@app.route('/api/cached/<cache_key>', methods=['DELETE'])
def delete_cached(cache_key):
    """Delete cached entry"""
    if cache_key in cache:
        del cache[cache_key]
        return jsonify({'message': 'Cache entry deleted'})
    
    return jsonify({'error': 'Cache entry not found'}), 404

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large. Maximum 10MB'}), 413

@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({'error': 'Rate limit exceeded. Please try again later'}), 429

if __name__ == '__main__':
    print(f"Text Processing API starting on http://localhost:5000")
    print(f"Cache TTL: {CACHE_TTL / 60} minutes")
    print(f"Word2Vec model: {'Loaded' if word2vec_model else 'Not loaded'}")
    app.run(debug=True, host='0.0.0.0', port=5000)
    # with open('../Chapter1.txt', 'r') as f:
    #     text = f.read()
    # results = process_text(text)
    # print("Sample processing results:")
    # import json
    # with open('results.json', 'w') as f:
    #     json.dump(results, f, indent=4)
