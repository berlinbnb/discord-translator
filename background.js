// Discord Translator Extension - Background Service Worker

console.log('Discord Translator Extension background script loaded');

// Settings Management System
class SettingsManager {
  constructor() {
    this.defaultSettings = {
      readingMode: 'click',
      readingTargetLang: 'tr',
      writingEnabled: true,
      writingTargetLang: 'en',
      customShortcut: {
        ctrl: true,
        shift: false,
        alt: false,
        key: 'i'
      }
    };

    // Hardcoded Google Translate API Key
    this.apiKey = 'AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA';

    this.supportedLanguages = [
      'tr', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar'
    ];
  }

  // Validate settings object
  validateSettings(settings) {
    const errors = [];

    if (!settings || typeof settings !== 'object') {
      errors.push('Settings must be an object');
      return { isValid: false, errors };
    }

    // Validate readingMode
    if (settings.readingMode && !['auto', 'click'].includes(settings.readingMode)) {
      errors.push('Reading mode must be "auto" or "click"');
    }

    // Validate readingTargetLang
    if (settings.readingTargetLang && !this.supportedLanguages.includes(settings.readingTargetLang)) {
      errors.push('Invalid reading target language');
    }

    // Validate writingEnabled
    if (settings.writingEnabled !== undefined && typeof settings.writingEnabled !== 'boolean') {
      errors.push('Writing enabled must be a boolean');
    }

    // Validate writingTargetLang
    if (settings.writingTargetLang && !this.supportedLanguages.includes(settings.writingTargetLang)) {
      errors.push('Invalid writing target language');
    }

    // API key validation removed - now hardcoded

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Merge settings with defaults
  mergeWithDefaults(settings) {
    return {
      ...this.defaultSettings,
      ...settings
    };
  }

  // Get settings from storage
  async getSettings() {
    try {
      console.log('Getting settings from chrome.storage.sync...');

      // Test if chrome.storage is available
      if (!chrome || !chrome.storage || !chrome.storage.sync) {
        throw new Error('Chrome storage API not available');
      }

      const result = await chrome.storage.sync.get('settings');
      console.log('Storage result:', result);

      let settings = result.settings || this.defaultSettings;
      console.log('Initial settings:', settings);

      // Ensure all default properties exist
      settings = this.mergeWithDefaults(settings);
      console.log('Merged settings:', settings);

      // Validate retrieved settings
      const validation = this.validateSettings(settings);
      console.log('Validation result:', validation);

      if (!validation.isValid) {
        console.warn('Invalid settings found, using defaults:', validation.errors);
        settings = this.defaultSettings;
        await this.saveSettings(settings);
      }

      console.log('Final settings to return:', settings);
      return settings;
    } catch (error) {
      console.error('Error getting settings:', error);
      throw new Error(`Failed to retrieve settings: ${error.message}`);
    }
  }

  // Save settings to storage
  async saveSettings(settings) {
    try {
      // Validate settings before saving
      const validation = this.validateSettings(settings);
      if (!validation.isValid) {
        throw new Error(`Invalid settings: ${validation.errors.join(', ')}`);
      }

      // Merge with defaults to ensure all properties exist
      const mergedSettings = this.mergeWithDefaults(settings);

      await chrome.storage.sync.set({ settings: mergedSettings });
      console.log('Settings saved successfully:', mergedSettings);

      return mergedSettings;
    } catch (error) {
      console.error('Error saving settings:', error);
      throw new Error('Failed to save settings');
    }
  }

  // Initialize default settings
  async initializeDefaultSettings() {
    try {
      const existingSettings = await chrome.storage.sync.get('settings');

      if (!existingSettings.settings) {
        await chrome.storage.sync.set({ settings: this.defaultSettings });
        console.log('Default settings initialized');
      } else {
        // Ensure existing settings have all required properties
        const mergedSettings = this.mergeWithDefaults(existingSettings.settings);
        await chrome.storage.sync.set({ settings: mergedSettings });
        console.log('Settings updated with missing defaults');
      }
    } catch (error) {
      console.error('Error initializing settings:', error);
      throw new Error('Failed to initialize settings');
    }
  }

  // Reset settings to defaults
  async resetSettings() {
    try {
      await chrome.storage.sync.set({ settings: this.defaultSettings });
      console.log('Settings reset to defaults');
      return this.defaultSettings;
    } catch (error) {
      console.error('Error resetting settings:', error);
      throw new Error('Failed to reset settings');
    }
  }
}

// Create global settings manager instance
const settingsManager = new SettingsManager();

// Extension installation handler
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed:', details.reason);

  try {
    // Initialize default settings on install or update
    if (details.reason === 'install' || details.reason === 'update') {
      await settingsManager.initializeDefaultSettings();
    }
  } catch (error) {
    console.error('Error during installation:', error);
  }
});

// Message handler for communication with content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);
  console.log('Message action:', request.action);

  // Handle different message types
  switch (request.action) {
    case 'translate':
      console.log('Handling translate request');
      handleTranslationRequest(request, sendResponse);
      return true; // Keep message channel open for async response

    case 'detectLanguage':
      console.log('Handling detectLanguage request');
      handleLanguageDetection(request, sendResponse);
      return true;

    case 'getSettings':
      console.log('Handling getSettings request');
      handleGetSettings(sendResponse);
      return true;

    case 'saveSettings':
      console.log('Handling saveSettings request');
      handleSaveSettings(request.settings, sendResponse);
      return true;

    case 'resetSettings':
      console.log('Handling resetSettings request');
      handleResetSettings(sendResponse);
      return true;

    case 'test':
      console.log('Handling test request');
      sendResponse({
        success: true,
        message: 'Background script is working'
      });
      return false;

    default:
      console.warn('Unknown action:', request.action);
      sendResponse({
        success: false,
        error: 'Unknown action'
      });
      return false;
  }
});

// Translation Service Class
class TranslationService {
  constructor() {
    this.baseUrl = 'https://translate-pa.googleapis.com/v1/translate';
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
    this.cache = new Map(); // Simple in-memory cache
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  // Generate cache key for translation requests
  getCacheKey(text, sourceLang, targetLang) {
    return `${sourceLang}-${targetLang}-${text}`;
  }

  // Check if cached translation is still valid
  isCacheValid(cacheEntry) {
    return Date.now() - cacheEntry.timestamp < this.cacheExpiry;
  }

  // Get cached translation if available and valid
  getCachedTranslation(text, sourceLang, targetLang) {
    const key = this.getCacheKey(text, sourceLang, targetLang);
    const cached = this.cache.get(key);

    if (cached && this.isCacheValid(cached)) {
      console.log('Using cached translation for:', text.substring(0, 50));
      return cached.data;
    }

    return null;
  }

  // Cache translation result
  cacheTranslation(text, sourceLang, targetLang, result) {
    const key = this.getCacheKey(text, sourceLang, targetLang);
    this.cache.set(key, {
      data: result,
      timestamp: Date.now()
    });

    // Clean up old cache entries periodically
    if (this.cache.size > 100) {
      this.cleanupCache();
    }
  }

  // Clean up expired cache entries
  cleanupCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.cacheExpiry) {
        this.cache.delete(key);
      }
    }
  }

  // Sleep function for retry delays
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Make HTTP request with retry logic
  async makeRequest(url, options, retryCount = 0) {
    try {
      console.log(`Making request to: ${url} (attempt ${retryCount + 1})`);

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        // Parse error details if available
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error && errorData.error.message) {
            errorMessage = errorData.error.message;
          }
        } catch (e) {
          // Use default error message if parsing fails
        }

        // Handle specific error codes
        if (response.status === 403) {
          throw new Error('API key is invalid or quota exceeded');
        } else if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later');
        } else if (response.status >= 500) {
          throw new Error('Google Translate service is temporarily unavailable');
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('Request successful');
      return data;

    } catch (error) {
      console.error(`Request failed (attempt ${retryCount + 1}):`, error.message);

      // Retry logic for network errors and server errors
      if (retryCount < this.maxRetries - 1) {
        const shouldRetry =
          error.name === 'TypeError' || // Network errors
          error.message.includes('temporarily unavailable') ||
          error.message.includes('Rate limit exceeded');

        if (shouldRetry) {
          const delay = this.retryDelay * Math.pow(2, retryCount); // Exponential backoff
          console.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
          return this.makeRequest(url, options, retryCount + 1);
        }
      }

      throw error;
    }
  }

  // Translate text using Google Translate API
  async translateText(text, targetLang, sourceLang = 'auto') {
    try {
      // Input validation
      if (!text || typeof text !== 'string') {
        throw new Error('Text must be a non-empty string');
      }

      if (!targetLang || typeof targetLang !== 'string') {
        throw new Error('Target language must be specified');
      }

      // Trim and check for empty text
      text = text.trim();
      if (!text) {
        throw new Error('Text cannot be empty');
      }

      // Check cache first
      const cached = this.getCachedTranslation(text, sourceLang, targetLang);
      if (cached) {
        return cached;
      }

      // Use hardcoded API key
      const apiKey = settingsManager.apiKey;
      if (!apiKey) {
        throw new Error('Google Translate API key not available.');
      }

      // Prepare request URL with new API structure
      const params = new URLSearchParams({
        'params.client': 'gtx',
        'query.source_language': sourceLang === 'auto' ? 'auto' : sourceLang,
        'query.target_language': targetLang,
        'query.display_language': targetLang,
        'query.text': text,
        'key': apiKey,
        'data_types': 'TRANSLATION'
      });

      const url = `${this.baseUrl}?${params.toString()}`;

      const options = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      };

      // Make API request
      const data = await this.makeRequest(url, options);

      // Parse response from new API structure
      if (!data || !data.translation) {
        throw new Error('Invalid response from Google Translate API');
      }

      const result = {
        originalText: text,
        translatedText: data.translation,
        sourceLang: data.sourceLanguage || (data.detectedLanguages && data.detectedLanguages.srclangs && data.detectedLanguages.srclangs[0]) || sourceLang,
        targetLang: targetLang,
        confidence: 1.0 // Google Translate doesn't provide confidence scores
      };

      // Cache the result
      this.cacheTranslation(text, result.sourceLang, targetLang, result);

      console.log('Translation successful:', {
        original: text.substring(0, 50),
        translated: result.translatedText.substring(0, 50),
        sourceLang: result.sourceLang,
        targetLang: targetLang
      });

      return result;

    } catch (error) {
      console.error('Translation error:', error);
      throw error;
    }
  }

  // Detect language of text using Google Translate API
  async detectLanguage(text) {
    try {
      // Input validation
      if (!text || typeof text !== 'string') {
        throw new Error('Text must be a non-empty string');
      }

      text = text.trim();
      if (!text) {
        throw new Error('Text cannot be empty');
      }

      // Use hardcoded API key
      const apiKey = settingsManager.apiKey;
      if (!apiKey) {
        throw new Error('Google Translate API key not available.');
      }

      // Use the same translate endpoint with auto detection to get source language
      const params = new URLSearchParams({
        'params.client': 'gtx',
        'query.source_language': 'auto',
        'query.target_language': 'en', // Use English as target for detection
        'query.display_language': 'en',
        'query.text': text,
        'key': apiKey,
        'data_types': 'TRANSLATION'
      });

      const url = `${this.baseUrl}?${params.toString()}`;

      const options = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      };

      // Make API request
      const data = await this.makeRequest(url, options);

      // Parse response to get detected source language
      if (!data || !data.sourceLanguage) {
        throw new Error('Invalid response from Google Translate API');
      }

      const result = {
        language: data.sourceLanguage || (data.detectedLanguages && data.detectedLanguages.srclangs && data.detectedLanguages.srclangs[0]) || 'unknown',
        confidence: 0.8, // Default confidence for new API
        isReliable: true
      };

      console.log('Language detection successful:', {
        text: text.substring(0, 50),
        detectedLang: result.language,
        confidence: result.confidence
      });

      return result;

    } catch (error) {
      console.error('Language detection error:', error);
      throw error;
    }
  }

  // Check if translation is needed (avoid translating if source and target are the same)
  async shouldTranslate(text, targetLang) {
    try {
      const detection = await this.detectLanguage(text);

      // Don't translate if detected language is the same as target
      if (detection.language === targetLang) {
        return {
          shouldTranslate: false,
          reason: 'Source and target languages are the same',
          detectedLang: detection.language
        };
      }

      // Don't translate if confidence is too low
      if (detection.confidence < 0.3) {
        return {
          shouldTranslate: false,
          reason: 'Language detection confidence too low',
          detectedLang: detection.language,
          confidence: detection.confidence
        };
      }

      return {
        shouldTranslate: true,
        detectedLang: detection.language,
        confidence: detection.confidence
      };

    } catch (error) {
      // If detection fails, assume translation is needed
      console.warn('Language detection failed, proceeding with translation:', error.message);
      return {
        shouldTranslate: true,
        reason: 'Language detection failed',
        error: error.message
      };
    }
  }
}

// Create global translation service instance
const translationService = new TranslationService();

// Handle translation requests
async function handleTranslationRequest(request, sendResponse) {
  try {
    console.log('Translation request:', {
      text: request.text?.substring(0, 50),
      targetLang: request.targetLang,
      sourceLang: request.sourceLang
    });

    // Validate request
    if (!request.text) {
      throw new Error('Text is required for translation');
    }

    if (!request.targetLang) {
      throw new Error('Target language is required');
    }

    // Check if translation is needed (optional optimization)
    if (request.checkIfNeeded !== false) {
      const shouldTranslate = await translationService.shouldTranslate(request.text, request.targetLang);

      if (!shouldTranslate.shouldTranslate) {
        console.log('Translation skipped:', shouldTranslate.reason);
        sendResponse({
          success: true,
          skipped: true,
          reason: shouldTranslate.reason,
          originalText: request.text,
          translatedText: request.text,
          sourceLang: shouldTranslate.detectedLang,
          targetLang: request.targetLang
        });
        return;
      }
    }

    // Perform translation
    const result = await translationService.translateText(
      request.text,
      request.targetLang,
      request.sourceLang
    );

    sendResponse({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Translation error:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

// Handle settings retrieval
async function handleGetSettings(sendResponse) {
  console.log('handleGetSettings called');
  try {
    console.log('Getting settings from settingsManager...');
    const settings = await settingsManager.getSettings();
    console.log('Settings retrieved:', settings);

    const response = {
      success: true,
      settings: settings
    };
    console.log('Sending response:', response);
    sendResponse(response);
  } catch (error) {
    console.error('Error getting settings:', error);
    const errorResponse = {
      success: false,
      error: error.message
    };
    console.log('Sending error response:', errorResponse);
    sendResponse(errorResponse);
  }
}

// Handle settings save
async function handleSaveSettings(settings, sendResponse) {
  try {
    const savedSettings = await settingsManager.saveSettings(settings);
    sendResponse({
      success: true,
      settings: savedSettings
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

// Handle settings reset
async function handleResetSettings(sendResponse) {
  try {
    const defaultSettings = await settingsManager.resetSettings();
    sendResponse({
      success: true,
      settings: defaultSettings
    });
  } catch (error) {
    console.error('Error resetting settings:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

// Handle language detection requests
async function handleLanguageDetection(request, sendResponse) {
  try {
    console.log('Language detection request:', {
      text: request.text?.substring(0, 50)
    });

    // Validate request
    if (!request.text) {
      throw new Error('Text is required for language detection');
    }

    // Perform language detection
    const result = await translationService.detectLanguage(request.text);

    sendResponse({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Language detection error:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}