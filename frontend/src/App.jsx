import React, { useState, useMemo } from 'react';
import { FileText, Upload, Loader, AlertCircle, Eye, EyeOff } from 'lucide-react';

const TextAnalyzer = () => {
  const [text, setText] = useState('');
  const [analyzed, setAnalyzed] = useState(false);
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hoveredWord, setHoveredWord] = useState(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [selectedParagraph, setSelectedParagraph] = useState(null);
  const [showSimilarWords, setShowSimilarWords] = useState(false);
  const [highlightedWords, setHighlightedWords] = useState(new Set());
  const hoverTimeoutRef = React.useRef(null);

  // const API_BASE = 'http://localhost:5000';
  const API_BASE = 'https://bookdebuggerbackend.onrender.com';

  // Process text into paragraphs and track word positions
  const processedText = useMemo(() => {
    if (!text.trim() || !apiData) return null;

    const paragraphs = text.split(/\n+/).filter(p => p.trim());
    const wordPositions = {}; // Track all positions of each word
    
    const processed = paragraphs.map((para, pIdx) => {
      const sentences = apiData.sentences || [];
      const words = para.toLowerCase().match(/\b[a-z]+\b/g) || [];
      
      // Track word positions in this paragraph
      const paraWordPositions = [];
      let wordIndex = 0;
      para.split(/\b/).forEach((segment, sIdx) => {
        const cleanWord = segment.toLowerCase().replace(/[^a-z]/g, '');
        if (cleanWord && cleanWord.length > 0) {
          const position = { paragraph: pIdx, segment: sIdx, word: cleanWord };
          paraWordPositions.push(position);
          
          if (!wordPositions[cleanWord]) {
            wordPositions[cleanWord] = [];
          }
          wordPositions[cleanWord].push(position);
          wordIndex++;
        }
      });
      
      const paraSentences = sentences.filter(sent => 
        para.includes(sent.substring(0, Math.min(20, sent.length)))
      );
      
      return {
        text: para,
        sentences: paraSentences,
        words: words,
        wordCount: words.length,
        sentenceCount: paraSentences.length || 1,
        avgSentenceLength: words.length / (paraSentences.length || 1),
        index: pIdx,
        wordPositions: paraWordPositions
      };
    });

    return { paragraphs: processed, wordPositions };
  }, [text, apiData]);

  // Calculate statistics from API data
  const stats = useMemo(() => {
    if (!apiData || !processedText) return null;

    const wordDict = apiData.word_dictionary || {};
    const apiStats = apiData.statistics || {};

    return {
      totalWords: apiStats.word_count || 0,
      uniqueWords: apiStats.unique_word_count || 0,
      totalSentences: apiStats.sentence_count || 0,
      avgSentenceLength: apiStats.avg_words_per_sentence || 0,
      avgWordLength: apiStats.avg_word_length || 0,
      contentWords: apiStats.content_word_count || 0,
      stopwords: apiStats.stopword_count || 0,
      lexicalDensity: apiStats.unique_word_count && apiStats.word_count 
        ? (apiStats.unique_word_count / apiStats.word_count * 100).toFixed(1) 
        : 0,
      wordDict: wordDict,
      topWords: apiData.top_words || [],
      hasEmbeddings: !!apiData.document_embedding,
      embeddingCoverage: apiData.embedding_coverage || 0
    };
  }, [apiData, processedText]);

  // Get word similarity from embeddings
  const findSimilarWords = async (word) => {
    if (!word || !stats?.hasEmbeddings) return [];
    
    try {
      const wordInfo = stats.wordDict[word.toLowerCase()];
      if (!wordInfo || !wordInfo.embedding) return [];
      
      const similarities = [];
      Object.entries(stats.wordDict).forEach(([w, info]) => {
        if (w !== word.toLowerCase() && info.embedding && !info.is_stopword) {
          let similarity = 0;
          for (let i = 0; i < Math.min(info.embedding.length, wordInfo.embedding.length); i++) {
            similarity += info.embedding[i] * wordInfo.embedding[i];
          }
          similarities.push({ word: w, score: similarity });
        }
      });
      
      return similarities
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    } catch (err) {
      console.error('Error finding similar words:', err);
      return [];
    }
  };

  const [similarWords, setSimilarWords] = useState({});

  const getSentenceLengthColor = (avgLength) => {
    if (avgLength < 15) return 'bg-green-100 border-green-300';
    if (avgLength < 25) return 'bg-yellow-100 border-yellow-300';
    return 'bg-red-100 border-red-300';
  };

  const handleWordHover = async (word, event) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    const rect = event.target.getBoundingClientRect();
    setHoverPosition({ 
      x: rect.left + rect.width / 2, 
      y: rect.top - 10 
    });
    setHoveredWord(word);
    
    // Highlight all occurrences of this word
    if (!showSimilarWords) {
      setHighlightedWords(new Set([word]));
    } else {
      // Load similar words if not cached
      if (!similarWords[word]) {
        const similar = await findSimilarWords(word);
        setSimilarWords(prev => ({ ...prev, [word]: similar }));
        
        // Highlight the word and its similar words
        const wordsToHighlight = new Set([word, ...similar.map(s => s.word)]);
        setHighlightedWords(wordsToHighlight);
      } else {
        const wordsToHighlight = new Set([word, ...similarWords[word].map(s => s.word)]);
        setHighlightedWords(wordsToHighlight);
      }
    }
  };

  const handleWordLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredWord(null);
      setHighlightedWords(new Set());
    }, 150);
  };

  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE}/api/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          options: {
            include_embeddings: true
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze text');
      }

      const data = await response.json();
      setApiData(data);
      setAnalyzed(true);
    } catch (err) {
      setError(err.message || 'Failed to connect to API. Make sure the server is running on port 5000.');
      console.error('API Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const fileText = e.target.result;
        setText(fileText);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('options', JSON.stringify({ include_embeddings: true }));

        const response = await fetch(`${API_BASE}/api/process/file`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to analyze file');
        }

        const data = await response.json();
        setApiData(data);
        setAnalyzed(true);
      };
      reader.readAsText(file);
    } catch (err) {
      setError(err.message || 'Failed to process file');
      console.error('File Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Get highlight color based on word type
  const getHighlightColor = (word) => {
    if (word === hoveredWord) {
      return 'bg-yellow-300 font-bold';
    }
    if (highlightedWords.has(word)) {
      if (showSimilarWords) {
        return 'bg-blue-200 font-semibold';
      } else {
        return 'bg-orange-200 font-semibold';
      }
    }
    return '';
  };

  if (!analyzed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <FileText className="w-16 h-16 mx-auto mb-4 text-indigo-600" />
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Text Analyzer</h1>
            <p className="text-gray-600">Upload or paste your text for detailed NLP analysis with Word2Vec embeddings</p>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-lg flex items-start">
              <AlertCircle className="w-5 h-5 text-red-600 mr-2 mt-0.5" />
              <div>
                <div className="font-semibold text-red-800">Error</div>
                <div className="text-red-700 text-sm">{error}</div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="mb-4">
              <label className="flex items-center justify-center w-full px-4 py-6 bg-indigo-50 border-2 border-dashed border-indigo-300 rounded-lg cursor-pointer hover:bg-indigo-100 transition">
                <Upload className="w-6 h-6 mr-2 text-indigo-600" />
                <span className="text-indigo-600 font-medium">Upload Text File</span>
                <input 
                  type="file" 
                  className="hidden" 
                  accept=".txt,.md,.log" 
                  onChange={handleFileUpload}
                  disabled={loading}
                />
              </label>
            </div>

            <div className="text-center text-gray-500 mb-4">or</div>

            <textarea
              className="w-full h-64 p-4 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
              placeholder="Paste your text here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={loading}
            />

            <button
              onClick={handleAnalyze}
              disabled={!text.trim() || loading}
              className="w-full mt-4 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center"
            >
              {loading ? (
                <>
                  <Loader className="w-5 h-5 mr-2 animate-spin" />
                  Analyzing with NLTK & Word2Vec...
                </>
              ) : (
                'Analyze Text'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Text Analysis</h1>
            {apiData?.cached && (
              <span className="text-xs text-green-600">✓ Loaded from cache</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* Toggle for similar words */}
            <button
              onClick={() => setShowSimilarWords(!showSimilarWords)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
                showSimilarWords 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              title={showSimilarWords ? 'Showing similar words on hover' : 'Showing repeated words on hover'}
            >
              {showSimilarWords ? (
                <>
                  <Eye className="w-4 h-4" />
                  Similar Words
                </>
              ) : (
                <>
                  <EyeOff className="w-4 h-4" />
                  Repeated Words
                </>
              )}
            </button>
            <button
              onClick={() => { setAnalyzed(false); setText(''); setApiData(null); setError(null); }}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              New Analysis
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Statistics Panel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-6 sticky top-24">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Document Statistics</h2>
            
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 rounded">
                <div className="text-sm text-gray-600">Total Words</div>
                <div className="text-2xl font-bold text-blue-600">{stats.totalWords}</div>
              </div>
              
              <div className="p-3 bg-green-50 rounded">
                <div className="text-sm text-gray-600">Unique Words</div>
                <div className="text-2xl font-bold text-green-600">{stats.uniqueWords}</div>
              </div>
              
              <div className="p-3 bg-purple-50 rounded">
                <div className="text-sm text-gray-600">Total Sentences</div>
                <div className="text-2xl font-bold text-purple-600">{stats.totalSentences}</div>
              </div>
              
              <div className="p-3 bg-orange-50 rounded">
                <div className="text-sm text-gray-600">Avg Sentence Length</div>
                <div className="text-2xl font-bold text-orange-600">{stats.avgSentenceLength.toFixed(1)} words</div>
              </div>
              
              <div className="p-3 bg-pink-50 rounded">
                <div className="text-sm text-gray-600">Avg Word Length</div>
                <div className="text-2xl font-bold text-pink-600">{stats.avgWordLength} chars</div>
              </div>
              
              <div className="mt-6 p-4 bg-indigo-50 border-2 border-indigo-300 rounded-lg">
                <h3 className="font-bold text-gray-800 mb-2">Lexical Density</h3>
                <div className="text-2xl font-bold text-indigo-600">{stats.lexicalDensity}%</div>
              </div>

              {stats.hasEmbeddings && (
                <div className="mt-4 p-4 bg-green-50 border-2 border-green-300 rounded-lg">
                  <h3 className="font-bold text-gray-800 mb-2">Word2Vec Coverage</h3>
                  <div className="text-2xl font-bold text-green-600">{(stats.embeddingCoverage * 100).toFixed(0)}%</div>
                  <div className="text-xs text-gray-600 mt-1">Words with embeddings</div>
                </div>
              )}

              <div className="mt-4 p-3 bg-gray-50 rounded">
                <div className="text-sm text-gray-600">Content Words</div>
                <div className="text-lg font-bold text-gray-800">{stats.contentWords}</div>
              </div>

              <div className="p-3 bg-gray-50 rounded">
                <div className="text-sm text-gray-600">Stopwords</div>
                <div className="text-lg font-bold text-gray-800">{stats.stopwords}</div>
              </div>
            </div>

            {/* Highlight Legend */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-bold text-gray-800 mb-3">Highlight Guide</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-4 bg-yellow-300 rounded"></div>
                  <span>Hovered word</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-4 bg-orange-200 rounded"></div>
                  <span>Repeated instances</span>
                </div>
                {stats.hasEmbeddings && (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-4 bg-blue-200 rounded"></div>
                    <span>Similar words (toggle on)</span>
                  </div>
                )}
              </div>
            </div>

            {selectedParagraph !== null && processedText.paragraphs[selectedParagraph] && (
              <div className="mt-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-lg">
                <h3 className="font-bold text-gray-800 mb-2">Paragraph {selectedParagraph + 1}</h3>
                <div className="text-sm space-y-1">
                  <div>Words: <span className="font-semibold">{processedText.paragraphs[selectedParagraph].wordCount}</span></div>
                  <div>Sentences: <span className="font-semibold">{processedText.paragraphs[selectedParagraph].sentenceCount}</span></div>
                  <div>Avg Length: <span className="font-semibold">{processedText.paragraphs[selectedParagraph].avgSentenceLength.toFixed(1)} words</span></div>
                </div>
              </div>
            )}

            {/* Top Words */}
            <div className="mt-6">
              <h3 className="font-bold text-gray-800 mb-3">Top Words</h3>
              <div className="space-y-2">
                {stats.topWords.slice(0, 10).map((item, idx) => {
                  const wordInfo = stats.wordDict[item.word] || {};
                  return (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <span className="font-medium text-gray-700">
                        {item.word}
                        {wordInfo.is_stopword && (
                          <span className="text-xs text-gray-400 ml-1">(stop)</span>
                        )}
                      </span>
                      <span className="text-gray-600">{item.count}×</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Text Display */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Interactive Text</h2>
            <p className="text-sm text-gray-600 mb-4">
              Hover over words to see {showSimilarWords ? 'similar words highlighted' : 'all instances highlighted'}.
              {stats.hasEmbeddings && <span className="text-green-600 ml-2">✓ Word2Vec enabled</span>}
            </p>
            
            <div className="space-y-4">
              {processedText && processedText.paragraphs.map((para, pIdx) => (
                <div
                  key={pIdx}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                    getSentenceLengthColor(para.avgSentenceLength)
                  } ${selectedParagraph === pIdx ? 'ring-4 ring-blue-400' : ''}`}
                  onClick={() => setSelectedParagraph(pIdx)}
                >
                  <div className="text-xs font-semibold text-gray-600 mb-2">
                    Paragraph {pIdx + 1} | {para.sentenceCount} sentences | Avg: {para.avgSentenceLength.toFixed(1)} words
                  </div>
                  <div className="text-gray-800 leading-relaxed">
                    {para.text.split(/\b/).map((segment, sIdx) => {
                      const cleanWord = segment.toLowerCase().replace(/[^a-z]/g, '');
                      if (cleanWord && cleanWord.length > 0) {
                        const hasEmbedding = stats.wordDict[cleanWord]?.embedding;
                        const highlightClass = getHighlightColor(cleanWord);
                        
                        return (
                          <span
                            key={sIdx}
                            className={`hover:bg-yellow-200 cursor-pointer transition-colors duration-150 ${highlightClass} ${
                              hasEmbedding ? 'border-b border-dotted border-green-400' : ''
                            }`}
                            onMouseEnter={(e) => handleWordHover(cleanWord, e)}
                            onMouseLeave={handleWordLeave}
                          >
                            {segment}
                          </span>
                        );
                      }
                      return <span key={sIdx}>{segment}</span>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Word Tooltip */}
      {hoveredWord && stats && stats.wordDict[hoveredWord] && (
        <div 
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${hoverPosition.x}px`,
            top: `${hoverPosition.y}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div className="bg-gray-900 text-white rounded-lg shadow-xl p-4 mb-2 max-w-xs">
            <div className="font-bold text-lg mb-2 text-yellow-300">"{hoveredWord}"</div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-300">Count:</span>
                <span className="font-semibold">{stats.wordDict[hoveredWord].count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Frequency:</span>
                <span className="font-semibold">{(stats.wordDict[hoveredWord].frequency * 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Type:</span>
                <span className="font-semibold">
                  {stats.wordDict[hoveredWord].is_stopword ? 'Stopword' : 'Content'}
                </span>
              </div>
              
              {processedText.wordPositions[hoveredWord] && (
                <div className="mt-2 pt-2 border-t border-gray-700">
                  <div className="text-gray-300">
                    Appears in: 
                    <span className="text-orange-400 ml-1 font-semibold">
                      {new Set(processedText.wordPositions[hoveredWord].map(p => p.paragraph)).size} paragraph(s)
                    </span>
                  </div>
                </div>
              )}
              
              {stats.wordDict[hoveredWord].embedding && (
                <div className="mt-2 pt-2 border-t border-gray-700">
                  <div className="text-gray-300">Embedding: 
                    <span className="text-green-400 ml-1">✓ {stats.wordDict[hoveredWord].embedding_dim}D</span>
                  </div>
                </div>
              )}
              
              {showSimilarWords && similarWords[hoveredWord] && similarWords[hoveredWord].length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-700">
                  <div className="font-semibold mb-2 text-gray-300">Similar Words (highlighted in blue):</div>
                  <div className="flex flex-wrap gap-1">
                    {similarWords[hoveredWord].map((sim, i) => (
                      <span key={i} className="text-xs bg-blue-800 px-2 py-1 rounded">
                        {sim.word}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {!showSimilarWords && stats.wordDict[hoveredWord].count > 1 && (
                <div className="mt-3 pt-2 border-t border-gray-700">
                  <div className="text-orange-400 text-xs">
                    All {stats.wordDict[hoveredWord].count} instances highlighted
                  </div>
                </div>
              )}
            </div>
            {/* Arrow pointing down */}
            <div 
              className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-full"
              style={{
                width: 0,
                height: 0,
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderTop: '8px solid #111827'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default TextAnalyzer;