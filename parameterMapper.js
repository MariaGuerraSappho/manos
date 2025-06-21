import * as Tone from 'tone';

class ParameterMapper {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.mappings = [];
        this.activeParameters = new Set();
        
        // Track previous randomizations to ensure variety
        this.previousEffects = new Set();
        this.previousHandParams = new Map();
        
        // Define available effects parameters
        this.availableParameters = {
            filter: ['frequency', 'Q', 'type'],
            delay: ['delayTime', 'feedback', 'wet'],
            reverb: ['decay', 'wet'],
            distortion: ['distortion', 'wet'],
            chorus: ['frequency', 'depth', 'wet'],
            pitchShift: ['pitch', 'wet'],
            compressor: ['threshold', 'ratio', 'attack', 'release'],
            eq: ['low', 'mid', 'high'],
            panner: ['pan'],
            vibrato: ['frequency', 'depth', 'wet'],
            phaser: ['frequency', 'octaves', 'wet'],
            tremolo: ['frequency', 'depth', 'wet'],
            bitCrusher: ['bits', 'wet'],
            volume: ['level'] // Add volume parameter
        };
        
        // Chaos level - 0 to 1 (0 = harmonic, 1 = chaotic)
        this.chaosLevel = 0.2; // Reduced from 0.3 for better performance by default
        
        // Define hand parameters
        this.handParameters = [
            'height',
            'fingerSpread',
            'positionX',
            'positionY',
            'proximity',
            'curl.thumb',
            'curl.index',
            'curl.middle',
            'curl.ring',
            'curl.overall',
            'velocity'
        ];
        
        // Parameter ranges for scaling - adjust to avoid extreme values
        this.parameterRanges = {
            filter: {
                frequency: { min: 200, max: 8000, scale: 'exponential' }, // More limited frequency range
                Q: { min: 0.1, max: 5, scale: 'exponential' }, // Lower max Q to avoid resonance peaks
                type: { min: 0, max: 1, scale: 'linear' }
            },
            delay: {
                delayTime: { min: 0.1, max: 0.6, scale: 'linear' }, // More conservative delay times
                feedback: { min: 0, max: 0.6, scale: 'linear' }, // Lower max feedback to prevent runaway
                wet: { min: 0, max: 0.5, scale: 'linear' } // Lower max wet to blend better
            },
            reverb: {
                decay: { min: 0.2, max: 3, scale: 'linear' }, // Lower max decay time
                wet: { min: 0, max: 0.5, scale: 'linear' } // Lower max wet for better mix
            },
            distortion: {
                distortion: { min: 0, max: 0.4, scale: 'linear' }, // Lower distortion to prevent harsh sounds
                wet: { min: 0, max: 0.5, scale: 'linear' }
            },
            chorus: {
                frequency: { min: 0.5, max: 3, scale: 'linear' }, // Less extreme modulation
                depth: { min: 0, max: 0.5, scale: 'linear' },
                wet: { min: 0, max: 0.5, scale: 'linear' }
            },
            pitchShift: {
                pitch: { min: -7, max: 7, scale: 'linear' }, // Limited to a perfect fifth up/down
                wet: { min: 0, max: 0.6, scale: 'linear' }
            },
            compressor: {
                threshold: { min: -40, max: -10, scale: 'linear' }, // Adjusted for better compression
                ratio: { min: 1, max: 6, scale: 'linear' },
                attack: { min: 0.01, max: 0.2, scale: 'exponential' },
                release: { min: 0.1, max: 0.3, scale: 'exponential' }
            },
            eq: {
                low: { min: -6, max: 6, scale: 'linear' }, // Less extreme EQ boosts/cuts
                mid: { min: -6, max: 6, scale: 'linear' },
                high: { min: -6, max: 6, scale: 'linear' }
            },
            panner: {
                pan: { min: -0.7, max: 0.7, scale: 'linear' } // Less extreme panning
            },
            vibrato: {
                frequency: { min: 2, max: 6, scale: 'linear' },
                depth: { min: 0, max: 0.4, scale: 'linear' },
                wet: { min: 0, max: 0.5, scale: 'linear' }
            },
            phaser: {
                frequency: { min: 0.2, max: 3, scale: 'linear' }, // Less extreme modulation
                octaves: { min: 1, max: 2, scale: 'linear' }, // Lower max octaves
                wet: { min: 0, max: 0.5, scale: 'linear' }
            },
            tremolo: {
                frequency: { min: 1, max: 8, scale: 'linear' },
                depth: { min: 0, max: 0.5, scale: 'linear' },
                wet: { min: 0, max: 0.5, scale: 'linear' }
            },
            bitCrusher: {
                bits: { min: 4, max: 8, scale: 'linear' }, // Increased minimum bits for cleaner sound
                wet: { min: 0, max: 0.4, scale: 'linear' } // Lower wet mix for this harsh effect
            },
            volume: {
                level: { min: 0, max: 1, scale: 'linear' }
            }
        };
        
        // Track previous values for detecting changes
        this.previousValues = {};
        this.activeEffectChanges = [];
        
        // Add selected effects property - by default all effects are selected
        this.selectedEffects = Object.keys(this.availableParameters).filter(type => type !== 'volume');
        
        // Add throttling support
        this.throttled = false;
        this.processingTime = 0;
        this.lastProcessTime = 0;
        this.consecutiveHeavyProcessing = 0;
        this.lastHeavyLoadTime = 0;
        
        // Add smooth value caching for performance
        this.smoothedValues = {};
        this.paramValueCache = {};
        
        // Add memoization for hand parameters
        this.memoizedHandParams = new Map();
        this.memoizationHits = 0;
        this.memoizationCalls = 0;
        
        // Add processing debounce
        this.lastProcessTimestamp = 0;
        this.minProcessInterval = 16; // Min 16ms between hand updates (approx 60fps)
    }
    
    // Helper method to shuffle arrays for more randomness
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
    
    createRandomMappings(count = 5, chaosLevel = this.chaosLevel) {
        // Store the chaos level
        this.chaosLevel = chaosLevel;
        
        // Save current effects for comparison
        const oldEffects = new Set(this.previousEffects);
        this.previousEffects = new Set();
        
        // Clear existing mappings
        this.clearMappings();
        
        // Always add volume mapping for hand proximity - this is dedicated and exclusive
        this.addMapping('volume', 'level', 'proximity');
        
        // Make sure we're only using selected effects
        // Filter effect types to only include selected effects
        const effectTypes = [...this.selectedEffects].filter(type => type !== 'volume');
        
        // If no effects are selected (except volume), add a default one to prevent errors
        if (effectTypes.length === 0) {
            effectTypes.push('filter');
            console.warn('No effects selected, defaulting to filter');
        }
        
        console.log('Creating random mappings with only these effects:', effectTypes);
        
        // Shuffle all available effects for more randomness
        this.shuffleArray(effectTypes);
        
        // Number of effects varies by chaos level
        const minEffects = Math.min(2, effectTypes.length); // At least 2 effects if available
        const maxEffects = Math.min(8, effectTypes.length); // Maximum 8 effects
        const randomEffectCount = Math.floor(minEffects + chaosLevel * (maxEffects - minEffects));
        
        // Sort effects to prioritize ones NOT used in previous randomization
        const effectPool = [...effectTypes].sort((a, b) => {
            const aWasUsed = oldEffects.has(a);
            const bWasUsed = oldEffects.has(b);
            
            if (aWasUsed && !bWasUsed) return 1; // Prefer effects not used before
            if (!aWasUsed && bWasUsed) return -1;
            return Math.random() - 0.5; // Additional shuffle
        });
        
        // Harmonic effects (preferred at low chaos)
        const harmonicEffects = ['reverb', 'chorus', 'filter', 'eq', 'panner'];
        // Chaotic effects (preferred at high chaos)
        const chaoticEffects = ['distortion', 'bitCrusher', 'pitchShift', 'phaser'];
        
        // Select effects with bias toward unused ones
        const selectedEffects = [];
        
        // Force include at least one drastically different effect type based on chaos
        if (chaosLevel < 0.3) {
            // Force include one chaotic effect for variety at low chaos
            const unusedChaotic = chaoticEffects.filter(e => !oldEffects.has(e) && effectTypes.includes(e));
            if (unusedChaotic.length > 0) {
                const forcedEffect = unusedChaotic[Math.floor(Math.random() * unusedChaotic.length)];
                selectedEffects.push(forcedEffect);
                this.previousEffects.add(forcedEffect);
                effectPool.splice(effectPool.indexOf(forcedEffect), 1);
            }
        } else if (chaosLevel > 0.7) {
            // Force include one harmonic effect for variety at high chaos
            const unusedHarmonic = harmonicEffects.filter(e => !oldEffects.has(e) && effectTypes.includes(e));
            if (unusedHarmonic.length > 0) {
                const forcedEffect = unusedHarmonic[Math.floor(Math.random() * unusedHarmonic.length)];
                selectedEffects.push(forcedEffect);
                this.previousEffects.add(forcedEffect);
                effectPool.splice(effectPool.indexOf(forcedEffect), 1);
            }
        }
        
        // Fill remaining effects
        while (selectedEffects.length < randomEffectCount && effectPool.length > 0) {
            // Take from the beginning (biased towards unused effects)
            const effect = effectPool.shift();
            selectedEffects.push(effect);
            this.previousEffects.add(effect);
        }
        
        // Create mappings for selected effects
        for (const effectType of selectedEffects) {
            const parameterOptions = [...this.availableParameters[effectType]];
            this.shuffleArray(parameterOptions); // Shuffle parameters for more variety
            
            // Chaos affects how many parameters we map
            const maxParams = parameterOptions.length;
            const paramCount = Math.min(
                Math.ceil(((chaosLevel * 0.6) + 0.4) * maxParams), // More parameters at all chaos levels
                maxParams
            );
            
            const selectedParams = [];
            
            for (let i = 0; i < paramCount && parameterOptions.length > 0; i++) {
                const param = parameterOptions.shift();
                selectedParams.push(param);
                
                // Get a randomized list of hand parameters with previously unused ones preferred
                const previousParamsForEffect = this.previousHandParams.get(effectType) || new Set();
                const handParamOptions = [...this.handParameters].filter(p => p !== 'proximity');
                
                // Sort to prefer unused hand parameters
                handParamOptions.sort((a, b) => {
                    const aWasUsed = previousParamsForEffect.has(a);
                    const bWasUsed = previousParamsForEffect.has(b);
                    
                    if (aWasUsed && !bWasUsed) return 1; // Prefer params not used before
                    if (!aWasUsed && bWasUsed) return -1;
                    return Math.random() - 0.5; // Additional shuffle
                });
                
                // Select hand parameter
                const handParam = handParamOptions[0];
                
                // Track for next randomization
                if (!this.previousHandParams.has(effectType)) {
                    this.previousHandParams.set(effectType, new Set());
                }
                this.previousHandParams.get(effectType).add(handParam);
                
                // Randomize inversion more heavily - creates more variety
                const inverted = Math.random() > 0.4; // Slight bias towards inverted (was 0.5)
                
                this.addMapping(effectType, param, handParam, inverted);
                
                // Initialize effect with randomized wet values for more variety
                if (param === 'wet') {
                    // More randomized wet values (between 0.2 and 0.7)
                    const wetValue = 0.2 + (Math.random() * 0.5);
                    this.audioEngine.setEffectParameter(effectType, param, wetValue);
                }
            }
        }
        
        // Reset previous values
        this.previousValues = {};
        
        console.log('Created mappings with selected effects:', selectedEffects);
        
        // Return the created mappings
        return this.mappings;
    }
    
    addMapping(effectType, effectParameter, handParameter, inverted = false) {
        // Validate parameters
        if (!this.availableParameters[effectType] || 
            !this.availableParameters[effectType].includes(effectParameter) ||
            !this.handParameters.includes(handParameter)) {
            console.error('Invalid mapping parameters');
            return false;
        }
        
        // Create the mapping
        const mapping = {
            effectType,
            effectParameter,
            handParameter,
            inverted
        };
        
        this.mappings.push(mapping);
        return true;
    }
    
    removeMapping(index) {
        if (index >= 0 && index < this.mappings.length) {
            this.mappings.splice(index, 1);
            return true;
        }
        return false;
    }
    
    clearMappings() {
        this.mappings = [];
    }
    
    processHandData(handData) {
        // Skip processing if there's no hand data
        if (!handData) {
            // Reset active parameters
            this.activeParameters.clear();
            this.activeEffectChanges = [];
            
            // Hand not present, use baseline volume
            this.audioEngine.setEffectParameter('volume', 'volume', this.audioEngine.baselineVolume);
            
            // Gradually fade out all sounds if no hand is detected
            this.audioEngine.fadeOutAll();
            return;
        }
        
        // Performance optimization: Throttle updates when processing is heavy
        const now = performance.now();
        const timeSinceLastProcess = now - this.lastProcessTimestamp;
        
        // Only process at most 60 times per second to save CPU (or 30fps when throttled)
        const currentMinInterval = this.throttled ? 33 : this.minProcessInterval;
        if (timeSinceLastProcess < currentMinInterval) {
            return;
        }
        
        this.lastProcessTimestamp = now;
        
        // Measure processing time to detect heavy loads
        const processStart = performance.now();
        
        try {
            // Process volume control first to ensure it always works
            const volumeMapping = this.mappings.find(m => m.effectType === 'volume' && m.effectParameter === 'level');
            if (volumeMapping) {
                const proximity = handData.proximity;
                
                // Get baseline volume from the audio engine
                const baselineVolume = this.audioEngine.baselineVolume || -10;
                
                // More conservative scaling to prevent extremes
                // Scale proximity to a volume range around baseline (-12 to +3 dB from baseline)
                const volumeOffset = (proximity * 15) - 12; // Maps 0-1 to -12 to +3
                const volumeValue = baselineVolume + volumeOffset;
                
                // Apply the volume directly with smoother transition
                this.audioEngine.setEffectParameter('volume', 'volume', volumeValue);
                
                // Add to active effect changes for internal tracking
                this.activeEffectChanges.push({
                    effectType: 'volume',
                    parameter: 'level',
                    value: proximity,
                    normalized: proximity,
                    handParameter: 'proximity'
                });
            }
            
            // Create a map of effect types to prevent too many of the same type
            const activeEffectTypes = new Map();
            
            // Get list of active mappings - more aggressive throttling when needed
            let activeMappings;
            if (this.throttled) {
                // When throttled, only process essential effects
                activeMappings = this.mappings.filter(m => 
                    m.effectType === 'volume' || 
                    m.effectType === 'filter' || 
                    m.effectType === 'panner');
            } else {
                // Even when not throttled, limit the number of mappings processed per frame
                // to reduce CPU load - process at most 8 mappings
                activeMappings = this.mappings.slice(0, 8);
            }
            
            // Process other mappings with smoother transitions
            for (const mapping of activeMappings) {
                // Skip volume as we already processed it
                if (mapping.effectType === 'volume') continue;
                
                // Count active instances of this effect type
                const currentCount = activeEffectTypes.get(mapping.effectType) || 0;
                activeEffectTypes.set(mapping.effectType, currentCount + 1);
                
                // Limit the number of active parameters per effect type to prevent overload
                if (currentCount >= 2 && mapping.effectParameter !== 'wet') {
                    continue; // Skip this mapping to prevent too many changes
                }
                
                // Try to use memoized parameter value if available
                const paramKey = mapping.handParameter + (mapping.inverted ? '_inv' : '');
                this.memoizationCalls++;
                
                let value;
                if (this.memoizedHandParams.has(paramKey)) {
                    value = this.memoizedHandParams.get(paramKey);
                    this.memoizationHits++;
                } else {
                    // Extract the hand parameter value
                    const paramPath = mapping.handParameter.split('.');
                    value = handData;
                    
                    for (const key of paramPath) {
                        value = value[key];
                        if (value === undefined) break;
                    }
                    
                    // Apply inversion if needed
                    if (value !== undefined && mapping.inverted) {
                        value = 1 - value;
                    }
                    
                    // Store in memoization cache
                    this.memoizedHandParams.set(paramKey, value);
                }
                
                if (value === undefined) continue;
                
                // Scale the hand parameter to the effect parameter range
                const range = this.parameterRanges[mapping.effectType][mapping.effectParameter];
                
                if (!range) continue;
                
                // Apply smoothing to the value
                value = this.smoothParameter(mapping.effectType, mapping.effectParameter, value, 0.3);
                
                let scaledValue;
                
                if (range.scale === 'exponential') {
                    // For exponential scaling (e.g., frequency)
                    const minLog = Math.log(range.min);
                    const maxLog = Math.log(range.max);
                    scaledValue = Math.exp(minLog + value * (maxLog - minLog));
                } else {
                    // For linear scaling
                    scaledValue = range.min + value * (range.max - range.min);
                }
                
                // Additional processing for specific effect parameters to improve sound quality
                if (mapping.effectType === 'pitchShift' && mapping.effectParameter === 'pitch') {
                    // Round pitch to nearest semitone or half-semitone for more musical results
                    scaledValue = Math.round(scaledValue * 2) / 2;
                }
                
                // Check if the value has changed significantly
                const mappingKey = `${mapping.effectType}-${mapping.effectParameter}`;
                const previousValue = this.previousValues[mappingKey] || 0;
                const changeThreshold = 0.01 * (range.max - range.min);
                
                if (Math.abs(scaledValue - previousValue) > changeThreshold) {
                    this.previousValues[mappingKey] = scaledValue;
                    
                    // Add to active parameters
                    this.activeParameters.add(mappingKey);
                    
                    // Add to active effect changes for internal tracking
                    this.activeEffectChanges.push({
                        effectType: mapping.effectType,
                        parameter: mapping.effectParameter,
                        value: scaledValue,
                        normalized: value,
                        handParameter: mapping.handParameter
                    });
                    
                    // Apply the value to the effect
                    this.audioEngine.setEffectParameter(mapping.effectType, mapping.effectParameter, scaledValue);
                }
            }
            
            // Make sure volume uses proximity only
            this.audioEngine.fadeInAll();
            
            // Clear memoization cache after use
            this.memoizedHandParams.clear();
            
            // Measure processing time
            const processEnd = performance.now();
            this.processingTime = processEnd - processStart;
            
            // Detect if processing is taking too long (more than 8ms)
            if (this.processingTime > 8) {
                this.consecutiveHeavyProcessing++;
                this.lastHeavyLoadTime = processEnd;
                
                if (this.consecutiveHeavyProcessing > 5 && !this.throttled) {
                    this.enableThrottling();
                }
            } else {
                // Reduce consecutive count but don't reset completely
                this.consecutiveHeavyProcessing = Math.max(0, this.consecutiveHeavyProcessing - 0.2);
                
                // Check if we should disable throttling
                if (this.throttled && this.consecutiveHeavyProcessing < 1 && 
                    (processEnd - this.lastHeavyLoadTime) > 5000) {
                    this.disableThrottling();
                }
            }
            
        } catch (error) {
            console.error('Error processing hand data:', error);
            // Recover from errors by enabling throttling
            this.enableThrottling();
        }
    }
    
    getActiveEffectChanges() {
        return this.activeEffectChanges;
    }
    
    getMappingsDescription() {
        return this.mappings.map(mapping => {
            const handParamName = mapping.handParameter.replace('.', ' ');
            const effectParamName = mapping.effectParameter;
            
            return {
                id: Math.random().toString(36).substr(2, 9),
                text: `${mapping.inverted ? '↓' : '↑'} ${handParamName} → ${mapping.effectType} ${effectParamName}`
            };
        });
    }
    
    saveCurrentSettings(name) {
        const settings = {
            name: name || `Setting ${new Date().toLocaleTimeString()}`,
            mappings: JSON.parse(JSON.stringify(this.mappings)),
            id: Date.now().toString()
        };
        
        // Get existing settings from localStorage
        let savedSettings = [];
        try {
            const stored = localStorage.getItem('manos-settings');
            if (stored) {
                savedSettings = JSON.parse(stored);
            }
        } catch (e) {
            console.error('Error loading saved settings:', e);
        }
        
        // Add new settings
        savedSettings.push(settings);
        
        // Save to localStorage
        try {
            localStorage.setItem('manos-settings', JSON.stringify(savedSettings));
            return settings;
        } catch (e) {
            console.error('Error saving settings:', e);
            return null;
        }
    }
    
    loadSavedSettings(settingId) {
        try {
            const stored = localStorage.getItem('manos-settings');
            if (!stored) return false;
            
            const savedSettings = JSON.parse(stored);
            const setting = savedSettings.find(s => s.id === settingId);
            
            if (!setting) return false;
            
            // Apply the saved mappings
            this.clearMappings();
            this.mappings = setting.mappings;
            
            return true;
        } catch (e) {
            console.error('Error loading setting:', e);
            return false;
        }
    }
    
    getSavedSettings() {
        try {
            const stored = localStorage.getItem('manos-settings');
            if (!stored) return [];
            
            return JSON.parse(stored);
        } catch (e) {
            console.error('Error getting saved settings:', e);
            return [];
        }
    }
    
    deleteSavedSetting(settingId) {
        try {
            const stored = localStorage.getItem('manos-settings');
            if (!stored) return false;
            
            let savedSettings = JSON.parse(stored);
            savedSettings = savedSettings.filter(s => s.id !== settingId);
            
            localStorage.setItem('manos-settings', JSON.stringify(savedSettings));
            return true;
        } catch (e) {
            console.error('Error deleting setting:', e);
            return false;
        }
    }
    
    // Set chaos level
    setChaosLevel(level) {
        this.chaosLevel = Math.max(0, Math.min(1, level));
        console.log(`Chaos level set to: ${this.chaosLevel}`);
        return this.chaosLevel;
    }
    
    // Add an improved smoothing function for parameter changes
    smoothParameter(effectType, parameter, value, smoothingFactor = 0.3) {
        const key = `${effectType}-${parameter}`;
        
        if (!this.smoothedValues) {
            this.smoothedValues = {};
        }
        
        if (this.smoothedValues[key] === undefined) {
            this.smoothedValues[key] = value;
            return value;
        }
        
        // Use more aggressive smoothing for certain parameters
        let factor = smoothingFactor;
        
        // More smoothing for pitch shift to prevent artifacts
        if (effectType === 'pitchShift' && parameter === 'pitch') {
            factor = 0.15; // Much stronger smoothing
            
            // Round pitch to nearest half-step for music theory coherence
            const smoothed = this.smoothedValues[key] * (1 - factor) + value * factor;
            this.smoothedValues[key] = smoothed;
            return Math.round(smoothed * 2) / 2; // Round to nearest half-step
        }
        
        // More smoothing for filter frequency to prevent zipper noise
        if (effectType === 'filter' && parameter === 'frequency') {
            factor = 0.2; // Stronger smoothing
        }
        
        // Apply exponential smoothing
        this.smoothedValues[key] = this.smoothedValues[key] * (1 - factor) + value * factor;
        return this.smoothedValues[key];
    }
    
    // Add method to set selected effects
    setSelectedEffects(effectTypes) {
        // Always include volume in selected effects
        this.selectedEffects = effectTypes.includes('volume') ? 
            effectTypes : [...effectTypes, 'volume'];
        
        console.log('Parameter mapper selected effects set to:', this.selectedEffects);
        return this.selectedEffects;
    }
    
    // Add method to get selected effects
    getSelectedEffects() {
        return this.selectedEffects.filter(effect => effect !== 'volume');
    }
    
    // Enable throttling mode to reduce CPU usage
    enableThrottling() {
        if (this.throttled) return;
        
        console.warn('Enabling throttling mode due to heavy processing');
        this.throttled = true;
        
        // Increase minimum processing interval
        this.minProcessInterval = 33; // ~30fps
        
        // Notify the app that we're throttling
        if (window.manosApp && window.manosApp.throttleEffects) {
            window.manosApp.throttleEffects();
        }
    }
    
    // Disable throttling mode when performance improves
    disableThrottling() {
        if (!this.throttled) return;
        
        console.log('Disabling throttling mode, performance has improved');
        this.throttled = false;
        
        // Restore normal processing interval
        this.minProcessInterval = 16; // ~60fps
        
        // Notify the app that we're no longer throttling
        if (window.manosApp && window.manosApp.restoreEffects) {
            window.manosApp.restoreEffects();
        }
    }
}

export default ParameterMapper;