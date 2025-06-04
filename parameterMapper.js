import * as Tone from 'tone';

class ParameterMapper {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.mappings = [];
        this.activeParameters = new Set();
        
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
            volume: ['volume']
        };
        
        // Chaos level - 0 to 1 (0 = harmonic, 1 = chaotic)
        this.chaosLevel = 0.5;
        
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
        
        // Parameter ranges for scaling
        this.parameterRanges = {
            filter: {
                frequency: { min: 20, max: 20000, scale: 'exponential' },
                Q: { min: 0.1, max: 20, scale: 'exponential' },
                type: { min: 0, max: 1, scale: 'linear' }
            },
            delay: {
                delayTime: { min: 0.01, max: 1, scale: 'linear' },
                feedback: { min: 0, max: 0.95, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            reverb: {
                decay: { min: 0.1, max: 10, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            distortion: {
                distortion: { min: 0, max: 1, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            chorus: {
                frequency: { min: 0.1, max: 10, scale: 'linear' },
                depth: { min: 0, max: 1, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            pitchShift: {
                pitch: { min: -12, max: 12, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            compressor: {
                threshold: { min: -60, max: 0, scale: 'linear' },
                ratio: { min: 1, max: 20, scale: 'linear' },
                attack: { min: 0.001, max: 1, scale: 'exponential' },
                release: { min: 0.001, max: 1, scale: 'exponential' }
            },
            eq: {
                low: { min: -20, max: 20, scale: 'linear' },
                mid: { min: -20, max: 20, scale: 'linear' },
                high: { min: -20, max: 20, scale: 'linear' }
            },
            panner: {
                pan: { min: -1, max: 1, scale: 'linear' }
            },
            vibrato: {
                frequency: { min: 0.1, max: 20, scale: 'linear' },
                depth: { min: 0, max: 1, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            phaser: {
                frequency: { min: 0.1, max: 10, scale: 'linear' },
                octaves: { min: 1, max: 5, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            tremolo: {
                frequency: { min: 0.1, max: 20, scale: 'linear' },
                depth: { min: 0, max: 1, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            bitCrusher: {
                bits: { min: 1, max: 16, scale: 'linear' },
                wet: { min: 0, max: 1, scale: 'linear' }
            },
            volume: {
                volume: { min: 0, max: 1, scale: 'linear' }
            }
        };
        
        // Track previous values for detecting changes
        this.previousValues = {};
        this.activeEffectChanges = [];
    }
    
    createRandomMappings(count = 5, chaosLevel = this.chaosLevel) {
        // Store the chaos level
        this.chaosLevel = chaosLevel;
        
        // Clear existing mappings
        this.clearMappings();
        
        // Always add volume mapping for hand proximity - this is dedicated and exclusive
        this.addMapping('volume', 'volume', 'proximity');
        
        // Make sure we have at least one effect active
        const effectTypes = Object.keys(this.availableParameters).filter(type => type !== 'volume');
        
        // Number of effects varies by chaos level
        // Low chaos = fewer effects, high chaos = more effects
        const minEffects = 2;
        const maxEffects = Math.min(7, effectTypes.length);
        const randomEffectCount = Math.floor(minEffects + chaosLevel * (maxEffects - minEffects));
        
        // Randomly select effects to use
        const selectedEffects = [];
        const effectPool = [...effectTypes];
        
        // Harmonic effects (preferred at low chaos)
        const harmonicEffects = ['reverb', 'chorus', 'filter', 'eq', 'panner'];
        // Chaotic effects (preferred at high chaos)
        const chaoticEffects = ['distortion', 'bitCrusher', 'pitchShift', 'phaser'];
        
        // Sort effects by preference based on chaos level
        effectPool.sort((a, b) => {
            const aIsHarmonic = harmonicEffects.includes(a);
            const bIsHarmonic = harmonicEffects.includes(b);
            const aIsChaotic = chaoticEffects.includes(a);
            const bIsChaotic = chaoticEffects.includes(b);
            
            if (chaosLevel < 0.5) {
                // Prefer harmonic effects at low chaos
                if (aIsHarmonic && !bIsHarmonic) return -1;
                if (!aIsHarmonic && bIsHarmonic) return 1;
            } else {
                // Prefer chaotic effects at high chaos
                if (aIsChaotic && !bIsChaotic) return -1;
                if (!aIsChaotic && bIsChaotic) return 1;
            }
            return 0;
        });
        
        for (let i = 0; i < randomEffectCount; i++) {
            const randomIndex = Math.floor(Math.random() * Math.min(effectPool.length, randomEffectCount * 2));
            selectedEffects.push(effectPool.splice(randomIndex, 1)[0]);
            
            if (effectPool.length === 0) break;
        }
        
        // Always include filter for better sound control at low chaos levels
        if (chaosLevel < 0.7 && !selectedEffects.includes('filter')) {
            selectedEffects.push('filter');
        }
        
        // Create mappings for selected effects
        for (const effectType of selectedEffects) {
            const parameterOptions = this.availableParameters[effectType];
            
            // Chaos affects how many parameters we map
            // Low chaos = fewer parameters, high chaos = more parameters
            const maxParams = parameterOptions.length;
            const paramCount = Math.min(
                Math.ceil(((chaosLevel * 0.5) + 0.5) * maxParams), 
                maxParams
            );
            
            const selectedParams = [];
            
            for (let i = 0; i < paramCount; i++) {
                const randomParamIndex = Math.floor(Math.random() * parameterOptions.length);
                const param = parameterOptions[randomParamIndex];
                
                // Skip if already selected
                if (selectedParams.includes(param)) {
                    i--;
                    continue;
                }
                
                selectedParams.push(param);
                
                // Randomly select a hand parameter to map to this effect parameter
                // Skip proximity as it's reserved for volume control
                let handParam;
                do {
                    const handParamIndex = Math.floor(Math.random() * this.handParameters.length);
                    handParam = this.handParameters[handParamIndex];
                } while (handParam === 'proximity');
                
                // Add mapping with chaos-influenced settings
                const inverted = Math.random() > 0.5;
                this.addMapping(effectType, param, handParam, inverted);
                
                // Initialize effect with chaos-influenced default values
                if (param === 'wet') {
                    // Higher chaos = higher initial wet values
                    const wetValue = 0.3 + (chaosLevel * 0.4);
                    this.audioEngine.setEffectParameter(effectType, param, wetValue);
                }
            }
        }
        
        // Reset previous values
        this.previousValues = {};
        
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
        // Reset active parameters
        this.activeParameters.clear();
        this.activeEffectChanges = [];
        
        if (!handData || !this.audioEngine.playing) {
            // Hand not present or audio not playing, use baseline volume
            const baselineVolume = this.audioEngine.baselineVolume;
            this.audioEngine.setEffectParameter('volume', 'volume', baselineVolume);
            
            // Gradually fade out all sounds if no hand is detected
            this.audioEngine.fadeOutAll();
            return;
        }
        
        // Process volume control first to ensure it always works
        const volumeMapping = this.mappings.find(m => m.effectType === 'volume' && m.effectParameter === 'volume');
        if (volumeMapping) {
            const proximity = handData.proximity ?? 0.5;

            // Always get baseline volume directly from audio engine (single source of truth)
            const baselineVolume = this.audioEngine.baselineVolume;
            
            // Define how far user can go above and below baseline - increased range
            const maxAbove = 12;    // +12 dB above baseline (hand far)
            const maxBelow = -40;   // -40 dB below baseline (hand close)

            // Enhanced proximity mapping with improved curve for more obvious volume changes
            // Map proximity: 0 = close (min), 0.5 = baseline, 1 = far (max)
            let volumeValue;
            if (proximity < 0.5) {
                // Apply a curve to make smaller movements near the baseline more noticeable
                const percent = (proximity / 0.5) ** 1.5; // Steeper curve 
                volumeValue = baselineVolume + (maxBelow * (1 - percent));
            } else {
                // Apply similar curve for the upper half
                const percent = ((proximity - 0.5) / 0.5) ** 0.8; // Less steep curve for higher volumes
                volumeValue = baselineVolume + (maxAbove * percent);
            }

            // More aggressive smoothing for cleaner transitions
            const mappingKey = `${volumeMapping.effectType}-${volumeMapping.effectParameter}`;
            const previousVolume = this.previousValues[mappingKey] ?? baselineVolume;
            const smoothingFactor = 0.85; // Higher smoothing factor
            volumeValue = previousVolume * smoothingFactor + volumeValue * (1 - smoothingFactor);
            this.previousValues[mappingKey] = volumeValue;

            // Ensure volume is within safe limits
            volumeValue = Math.min(Math.max(volumeValue, -60), 12);
            
            this.audioEngine.setEffectParameter('volume', 'volume', volumeValue);

            this.activeEffectChanges.push({
                effectType: 'volume',
                parameter: 'volume',
                value: volumeValue,
                normalized: proximity,
                handParameter: 'proximity',
                baselineVolume: baselineVolume,
                volumeOffset: volumeValue - baselineVolume
            });
        }
        
        // Process other mappings
        for (const mapping of this.mappings) {
            // Skip volume as we already processed it
            if (mapping.effectType === 'volume') continue;
            
            // Extract the hand parameter value
            const paramPath = mapping.handParameter.split('.');
            let value = handData;
            
            for (const key of paramPath) {
                value = value[key];
                if (value === undefined) break;
            }
            
            if (value === undefined) continue;
            
            // Scale the hand parameter to the effect parameter range
            const range = this.parameterRanges[mapping.effectType][mapping.effectParameter];
            
            if (!range) continue;
            
            let scaledValue;
            
            // Apply inversion if needed
            value = mapping.inverted ? 1 - value : value;
            
            // Ensure value is within 0-1 range before scaling
            value = Math.min(Math.max(0, value), 1);
            
            if (range.scale === 'exponential') {
                // For exponential scaling (e.g., frequency)
                const minLog = Math.log(range.min);
                const maxLog = Math.log(range.max);
                scaledValue = Math.exp(minLog + value * (maxLog - minLog));
            } else {
                // For linear scaling
                scaledValue = range.min + value * (range.max - range.min);
            }
            
            // For parameters with strict ranges, clamp the values
            if (mapping.effectParameter === 'wet') {
                scaledValue = Math.min(Math.max(0, scaledValue), 1);
            }
            
            // Check if the value has changed significantly
            const mappingKey = `${mapping.effectType}-${mapping.effectParameter}`;
            const previousValue = this.previousValues[mappingKey] || 0;
            const changeThreshold = 0.01 * (range.max - range.min);
            
            if (Math.abs(scaledValue - previousValue) > changeThreshold) {
                this.previousValues[mappingKey] = scaledValue;
                
                // Add to active parameters
                this.activeParameters.add(mappingKey);
                
                // Add to active effect changes for display
                this.activeEffectChanges.push({
                    effectType: mapping.effectType,
                    parameter: mapping.effectParameter,
                    value: scaledValue,
                    normalized: value,
                    handParameter: mapping.handParameter
                });
            }
            
            // Apply the value to the effect
            this.audioEngine.setEffectParameter(mapping.effectType, mapping.effectParameter, scaledValue);
        }
        
        // Make sure we fade in if a hand is present
        this.audioEngine.fadeInAll();
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
}

export default ParameterMapper;