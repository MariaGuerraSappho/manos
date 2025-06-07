import * as Tone from 'tone';

class AudioEngine {
    constructor() {
        this.initialized = false;
        this.playing = false;
        this.currentSource = null;
        this.sourceType = null;
        
        // Audio sources
        this.noise = null;
        this.mic = null;
        this.player = null;
        this.testTone = null;
        
        // Multiple file handling
        this.audioFiles = [];
        this.currentFileIndex = 0;
        
        // Device selection
        this.availableMicrophones = [];
        this.availableOutputs = [];
        this.currentMicrophoneId = '';
        this.currentOutputId = '';
        
        // Effects
        this.effects = {
            filter: null,
            delay: null,
            reverb: null,
            distortion: null,
            chorus: null,
            pitchShift: null,
            compressor: null,
            eq: null,
            panner: null,
            vibrato: null,
            phaser: null,
            tremolo: null,
            bitCrusher: null,
            volume: null
        };
        
        // Default routing
        this.sourceNode = null;
        this.outputNode = null;
        this.effectsChain = [];
        
        // Master gain for fade-out
        this.masterGain = null;
        
        // Fade timer
        this.fadeTimer = null;
        
        // Baseline volume
        this.baselineVolume = -10;

        // Dry/wet control
        this.crossFade = null;
        this.postVolumeGain = null;
        this.dryWet = 0.5;
        
        // Hand presence flag
        this.handPresent = false;
    }
    
    async initialize() {
        // Don't start the audio context yet - wait for user interaction
        console.log('Audio engine initialized - waiting for user interaction');
        
        // Request microphone permission early (doesn't start the stream yet)
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Microphone permission granted during initialization');
        } catch (err) {
            console.warn('Initial microphone permission not granted:', err);
            // Continue anyway - we'll request again when needed
        }
        
        // Initialize effects
        this.initializeEffects();
        
        // Initialize sources
        this.initializeSources();
        
        // Set up default routing with master gain node and crossfade for dry/wet control
        this.masterGain = new Tone.Gain(1);
        this.sourceNode = new Tone.Gain();
        this.postVolumeGain = new Tone.Gain();
        this.crossFade = new Tone.CrossFade(this.dryWet);
        this.outputNode = new Tone.Gain();

        this.crossFade.connect(this.outputNode);
        this.outputNode.connect(this.masterGain);
        this.masterGain.toDestination();

        // Enumerate available audio devices
        await this.enumerateDevices();
        
        // Initialize volume to a reasonable level
        this.effects.volume.volume.value = 0;
        
        this.initialized = true;
        return true;
    }
    
    initializeEffects() {
        // Filters
        this.effects.filter = new Tone.Filter({
            type: 'lowpass',
            frequency: 20000,
            Q: 1
        });
        
        // Delay
        this.effects.delay = new Tone.FeedbackDelay({
            delayTime: 0.25,
            feedback: 0.3,
            wet: 0.5
        });
        
        // Reverb
        this.effects.reverb = new Tone.Reverb({
            decay: 3,
            wet: 0.3
        });
        
        // Distortion
        this.effects.distortion = new Tone.Distortion({
            distortion: 0.5,
            wet: 0
        });
        
        // Chorus
        this.effects.chorus = new Tone.Chorus({
            frequency: 4,
            delayTime: 2.5,
            depth: 0.5,
            wet: 0
        }).start();
        
        // Pitch Shift
        this.effects.pitchShift = new Tone.PitchShift({
            pitch: 0,
            windowSize: 0.1,
            wet: 0
        });
        
        // Compressor
        this.effects.compressor = new Tone.Compressor({
            threshold: -30,
            ratio: 12,
            attack: 0.005,
            release: 0.1,
            knee: 20
        });
        
        // EQ (3-band)
        this.effects.eq = new Tone.EQ3({
            low: 0,
            mid: 0,
            high: 0
        });
        
        // Panner
        this.effects.panner = new Tone.Panner(0);
        
        // Additional effects
        this.effects.vibrato = new Tone.Vibrato({
            frequency: 5,
            depth: 0.1,
            wet: 0
        });
        
        this.effects.phaser = new Tone.Phaser({
            frequency: 0.5,
            octaves: 3,
            wet: 0
        });
        
        this.effects.tremolo = new Tone.Tremolo({
            frequency: 5,
            depth: 0.5,
            wet: 0
        }).start();
        
        this.effects.bitCrusher = new Tone.BitCrusher({
            bits: 8,
            wet: 0
        });
        
        // Add volume control
        this.effects.volume = new Tone.Volume(0);
    }
    
    initializeSources() {
        // Pink Noise
        this.noise = new Tone.Noise('pink');
        
        // Microphone input
        this.mic = new Tone.UserMedia();
        
        // Player for uploaded files
        this.player = new Tone.Player();
        
        // Test tone (sine wave at 440Hz for volume testing)
        this.testTone = new Tone.Oscillator({
            frequency: 440,
            type: "sine",
            volume: -10
        });
    }
    
    async enumerateDevices() {
        try {
            // Request permissions first to ensure we get all labeled devices
            await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Get all media devices
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            // Filter for audio input devices (microphones)
            this.availableMicrophones = devices.filter(device => device.kind === 'audioinput');
            
            // Filter for audio output devices (speakers)
            this.availableOutputs = devices.filter(device => device.kind === 'audiooutput');
            
            // Populate device selection dropdowns
            this.populateDeviceSelectors();
            
            // Setup change listeners
            this.setupDeviceSelectionListeners();
            
            return true;
        } catch (error) {
            console.error('Error enumerating audio devices:', error);
            return false;
        }
    }
    
    populateDeviceSelectors() {
        const micSelect = document.getElementById('mic-select');
        const outputSelect = document.getElementById('output-select');
        
        // Clear existing options
        micSelect.innerHTML = '';
        outputSelect.innerHTML = '';
        
        // Add microphone options
        if (this.availableMicrophones.length > 0) {
            this.availableMicrophones.forEach(mic => {
                const option = document.createElement('option');
                option.value = mic.deviceId;
                option.text = mic.label || `Microphone ${mic.deviceId.slice(0, 5)}`;
                micSelect.appendChild(option);
            });
            
            // Enable the select element
            micSelect.disabled = false;
            
            // Set default microphone
            this.currentMicrophoneId = this.availableMicrophones[0].deviceId;
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.text = 'No microphones found';
            micSelect.appendChild(option);
        }
        
        // Add output options
        if (this.availableOutputs.length > 0) {
            this.availableOutputs.forEach(output => {
                const option = document.createElement('option');
                option.value = output.deviceId;
                option.text = output.label || `Speaker ${output.deviceId.slice(0, 5)}`;
                outputSelect.appendChild(option);
            });
            
            // Enable the select element
            outputSelect.disabled = false;
            
            // Set default output
            this.currentOutputId = this.availableOutputs[0].deviceId;
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.text = 'No speakers found';
            outputSelect.appendChild(option);
        }
    }
    
    async setupDeviceSelectionListeners() {
        const micSelect = document.getElementById('mic-select');
        const outputSelect = document.getElementById('output-select');
        
        // Microphone selection change
        micSelect?.addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            if (deviceId && deviceId !== this.currentMicrophoneId) {
                this.currentMicrophoneId = deviceId;
                
                // If current source is microphone, update it
                if (this.sourceType === 'mic' && this.playing) {
                    await this.mic.close();
                    this.mic = new Tone.UserMedia({ deviceId: { exact: this.currentMicrophoneId } });
                    await this.setSource('mic');
                }
            }
        });
        
        // Output selection change - completely revised implementation
        outputSelect?.addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            if (deviceId && deviceId !== this.currentOutputId) {
                this.currentOutputId = deviceId;
                
                // Store if we were playing
                const wasPlaying = this.playing;
                const currentVolume = this.effects.volume.volume.value;
                
                // Stop audio if it's playing
                if (wasPlaying) {
                    this.stop();
                }
                
                try {
                    console.log('Attempting to change audio output to device ID:', deviceId);
                    
                    // First, ensure the audio context is running
                    await Tone.start();
                    
                    // Create a dummy audio element to test setSinkId support
                    const audio = document.createElement('audio');
                    if (audio && typeof audio.setSinkId === 'function') {
                        try {
                            // Test if we can set the sink ID
                            await audio.setSinkId(deviceId);
                            console.log('Audio element setSinkId test successful');
                            
                            // Try to apply the sink ID to the Tone.js context
                            try {
                                if (Tone.context && Tone.context.destination && 
                                    typeof Tone.context.destination.setSinkId === 'function') {
                                    await Tone.context.destination.setSinkId(deviceId);
                                    console.log('Set sink ID on Tone context destination');
                                } else {
                                    console.log('Tone context destination setSinkId not available, using alternate method');
                                    
                                    // Restart Tone.js context with the new device
                                    await Tone.context.close();
                                    await Tone.start();
                                    
                                    // Create a new Audio context with the specified sink ID
                                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                                    if (audioContext.setSinkId) {
                                        await audioContext.setSinkId(deviceId);
                                        console.log('Set sink ID on new AudioContext');
                                    }
                                    
                                    // Update Tone.js to use this context
                                    Tone.setContext(audioContext);
                                }
                            } catch (ctxError) {
                                console.warn('Error setting sink ID on Tone context:', ctxError);
                            }
                            
                        } catch (sinkError) {
                            console.error('Error testing setSinkId:', sinkError);
                            
                            // Try the modern browser selection API
                            if (navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
                                try {
                                    await navigator.mediaDevices.selectAudioOutput();
                                    console.log('User selected output device via browser dialog');
                                } catch (selectError) {
                                    console.warn('Error with selectAudioOutput:', selectError);
                                }
                            }
                        }
                    } else {
                        // Alert user that their browser doesn't support this feature
                        console.warn('Browser does not support setSinkId');
                        alert('Your browser does not fully support changing audio output devices. ' +
                              'Try using the latest version of Chrome or Edge for this feature.');
                    }
                    
                    // Restart audio if it was playing
                    if (wasPlaying) {
                        // Slight delay to allow the audio context to stabilize
                        setTimeout(() => {
                            this.effects.volume.volume.value = currentVolume;
                            this.play();
                        }, 300);
                    }
                    
                } catch (error) {
                    console.error('Error setting audio output device:', error);
                    
                    // More helpful error message with browser-specific advice
                    let errorMessage = 'Could not change audio output device. ';
                    
                    if (error.name === 'NotAllowedError') {
                        errorMessage += 'Permission denied. Please grant permission to access audio devices.';
                    } else if (error.name === 'NotFoundError') {
                        errorMessage += 'The selected audio output device was not found.';
                    } else {
                        errorMessage += 'Please check your audio devices and browser permissions. ' +
                                      'Make sure you\'re using a recent version of Chrome or Edge.';
                    }
                    
                    alert(errorMessage);
                    
                    // Restart audio anyway if it was playing
                    if (wasPlaying) {
                        setTimeout(() => {
                            this.effects.volume.volume.value = currentVolume;
                            this.play();
                        }, 300);
                    }
                }
            }
        });
    }
    
    async setSource(sourceType) {
        if (!this.initialized) {
            await this.initialize();
        }
        
        console.log(`Setting audio source to: ${sourceType}`);
        
        // Prepare for transition - fade out current source
        if (this.playing && this.currentSource) {
            await this.fadeOut(0.2);
        }
        
        // Disconnect current source
        if (this.currentSource) {
            this.currentSource.disconnect();
        }
        
        this.sourceType = sourceType;
        
        try {
            switch (sourceType) {
                case 'noise':
                    this.currentSource = this.noise;
                    break;
                
                case 'mic':
                    try {
                        // Close existing microphone connection if any
                        if (this.mic.state === 'started') {
                            await this.mic.close();
                        }
                        
                        // Create new microphone with selected device
                        this.mic = new Tone.UserMedia({ 
                            deviceId: this.currentMicrophoneId ? { exact: this.currentMicrophoneId } : undefined 
                        });
                        await this.mic.open();
                        this.currentSource = this.mic;
                    } catch (e) {
                        console.error('Microphone access error:', e);
                        return false;
                    }
                    break;
                
                case 'file':
                    if (this.audioFiles.length === 0) {
                        console.error('No audio files loaded');
                        return false;
                    }
                    
                    // Set the current file based on the current index
                    await this.loadCurrentFile();
                    
                    if (!this.player.loaded) {
                        console.error('Could not load audio file');
                        return false;
                    }
                    
                    this.currentSource = this.player;
                    break;
                
                default:
                    console.error('Invalid source type');
                    return false;
            }
            
            // Connect to source node
            console.log(`Connecting ${sourceType} source to audio chain`);
            this.currentSource.connect(this.sourceNode);
            
            // Update effect chain
            this.updateEffectsChain();
            
            // If we were playing, fade back in
            if (this.playing) {
                this.fadeIn(0.2);
            }
            
            return true;
        } catch (e) {
            console.error(`Error setting source ${sourceType}:`, e);
            return false;
        }
    }
    
    async loadAudioFiles(files) {
        if (!files || files.length === 0) {
            return false;
        }
        
        // Clear existing files
        this.audioFiles = [];
        this.currentFileIndex = 0;
        
        // Process each file
        for (const file of files) {
            try {
                // Read the file as ArrayBuffer
                const buffer = await this.readFileAsArrayBuffer(file);
                
                // Store file info
                this.audioFiles.push({
                    name: file.name,
                    buffer: buffer,
                    size: file.size
                });
            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
                // Continue with other files
            }
        }
        
        // If we have files, set source to file
        if (this.audioFiles.length > 0) {
            await this.startAudioContext();
            try {
                await this.loadCurrentFile();
                this.currentSource = this.player;
                this.sourceType = 'file';
                this.currentSource.connect(this.sourceNode);
                this.updateEffectsChain();
                return true;
            } catch (error) {
                console.error("Error setting up audio file:", error);
                return false;
            }
        }
        
        return false;
    }
    
    async loadAudioFile(file) {
        return this.loadAudioFiles([file]);
    }
    
    async nextAudioFile() {
        if (this.audioFiles.length <= 1) return Promise.resolve(false);
        
        // Increment the current file index (with wrapping)
        this.currentFileIndex = (this.currentFileIndex + 1) % this.audioFiles.length;
        
        // If we're playing files, update the current file
        if (this.sourceType === 'file') {
            const wasPlaying = this.playing;
            
            this.stop();
            return this.loadCurrentFile().then(() => {
                this.currentSource = this.player;
                this.currentSource.connect(this.sourceNode);
                
                if (wasPlaying) {
                    this.play();
                }
                return Promise.resolve(true);
            });
        }
        
        return Promise.resolve(true);
    }
    
    getAudioFileList() {
        return this.audioFiles.map((file, index) => ({
            name: file.name,
            index: index,
            isCurrent: index === this.currentFileIndex
        }));
    }
    
    async loadCurrentFile() {
        if (this.audioFiles.length === 0) return Promise.resolve(false);
        
        try {
            // Create a new player for the current file
            this.player = new Tone.Player();
            
            // Get current file
            const currentFile = this.audioFiles[this.currentFileIndex];
            
            // Create an audio buffer from file data
            const arrayBuffer = currentFile.buffer;
            
            // Create AudioBuffer from the ArrayBuffer
            const audioContext = Tone.context;
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
            
            // Set the buffer on the player
            this.player.buffer = audioBuffer;
            
            // Set player to loop by default
            this.player.loop = true;
            
            return Promise.resolve(true);
        } catch (error) {
            console.error('Error loading current audio file:', error);
            return Promise.resolve(false);
        }
    }
    
    async startAudioContext() {
        try {
            // Start the audio context when user wants to play
            await Tone.start();
            
            // Additional check to make sure context is actually running
            if (Tone.context.state !== "running") {
                console.warn("Audio context not running after Tone.start(), attempting to resume...");
                await Tone.context.resume();
            }
            
            console.log('Audio context started and confirmed running:', Tone.context.state);
            return true;
        } catch (error) {
            console.error('Error starting audio context:', error);
            return false;
        }
    }
    
    updateEffectsChain() {
        // Disconnect existing routing
        this.sourceNode.disconnect();
        this.effectsChain.forEach(effect => effect.disconnect());
        this.postVolumeGain.disconnect();
        this.crossFade.a.disconnect();
        this.crossFade.b.disconnect();
        this.effectsChain = [];

        // Common preprocessing: compressor -> volume
        this.sourceNode.connect(this.effects.compressor);
        this.effects.compressor.connect(this.effects.volume);
        this.effects.volume.connect(this.postVolumeGain);

        // Dry path
        this.postVolumeGain.connect(this.crossFade.a);

        // Build wet chain starting from postVolumeGain
        let inputNode = this.postVolumeGain;

        for (const key in this.effects) {
            if (key === 'compressor' || key === 'volume') continue;

            const effect = this.effects[key];
            const alwaysInclude = key === 'filter' || key === 'eq' || key === 'panner';

            if (effect.wet && effect.wet.value > 0 || alwaysInclude) {
                this.effectsChain.push(effect);
            }
        }

        if (this.effectsChain.length > 0) {
            // Connect effects sequentially
            inputNode.connect(this.effectsChain[0]);
            for (let i = 0; i < this.effectsChain.length - 1; i++) {
                this.effectsChain[i].connect(this.effectsChain[i + 1]);
            }
            this.effectsChain[this.effectsChain.length - 1].connect(this.crossFade.b);
        } else {
            // No extra effects, connect straight to crossfade
            inputNode.connect(this.crossFade.b);
        }

        // Connect crossfade output to audio chain
        this.crossFade.connect(this.outputNode);

        console.log(`Effects chain updated with ${this.effectsChain.length} effects`);
        
        // Ensure master gain is connected to destination
        if (!this.masterGain.connected) {
            this.masterGain.toDestination();
            console.log("Reconnected master gain to destination");
        }
    }
    
    async play() {
        if (!this.initialized) {
            console.error('Audio engine not initialized');
            await this.initialize();
            if (!this.initialized) {
                console.error('Failed to initialize audio engine');
                return false;
            }
        }

        if (!this.currentSource) {
            console.error('No source selected, defaulting to noise');
            await this.setSource('noise');
            if (!this.currentSource) {
                console.error('Failed to set default source');
                return false;
            }
        }

        // Start the audio context when user wants to play
        await this.startAudioContext();
        console.log('Audio context started');
        
        if (this.playing) return true;
        
        try {
            // Make sure we have valid routing before playing
            console.log(`Playing audio source: ${this.sourceType}`);
            console.log(`Effects chain has ${this.effectsChain.length} effects`);
            
            switch (this.sourceType) {
                case 'noise':
                    this.noise.start();
                    break;
                
                case 'mic':
                    // Mic is already streaming once opened
                    break;
                
                case 'file':
                    if (!this.player.loaded) {
                        console.error('Player not loaded');
                        return false;
                    }
                    this.player.start();
                    break;
            }
            
            this.playing = true;
            
            // Double-check that master gain is not at zero
            if (this.masterGain.gain.value === 0) {
                console.log("Master gain was at zero, resetting to 1");
                this.masterGain.gain.rampTo(1, 0.1);
            }
            
            return true;
        } catch (e) {
            console.error('Error playing audio:', e);
            return false;
        }
    }
    
    stop() {
        if (!this.initialized || !this.currentSource) {
            return false;
        }
        
        if (!this.playing) return true;
        
        // Fade out before stopping
        this.fadeOut(1.5).then(() => {
            try {
                switch (this.sourceType) {
                    case 'noise':
                        this.noise.stop();
                        break;
                    
                    case 'mic':
                        // Don't close mic on stop to avoid reopening
                        break;
                    
                    case 'file':
                        this.player.stop();
                        break;
                }
            } catch (e) {
                console.error('Error stopping audio after fade out:', e);
            }
        });
        
        this.playing = false;
        return true;
    }
    
    fadeOut(duration = 0.5) {
        return new Promise(resolve => {
            if (!this.playing) {
                resolve(false);
                return;
            }
            
            // Store the current volume
            const currentVolume = this.effects.volume.volume.value;
            
            // Fade out using master gain to avoid affecting the volume control
            this.masterGain.gain.rampTo(0, duration);
            
            // Resolve after fade completes
            setTimeout(() => {
                resolve(true);
            }, duration * 1000);
        });
    }
    
    fadeIn(duration = 0.5) {
        if (!this.playing) return;
        
        // Fade in from silence using master gain to maintain volume control settings
        this.masterGain.gain.value = 0;
        this.masterGain.gain.rampTo(1, duration);
    }
    
    async startTestTone() {
        await this.startAudioContext();
        if (this.testTone.state !== "started") {
            // Make sure we're using the baseline volume
            this.effects.volume.volume.value = this.baselineVolume;
            
            this.testTone.start();
            this.testTone.connect(this.effects.volume);
            this.effects.volume.connect(this.masterGain);
            this.masterGain.gain.value = 1; // Ensure master gain is at full
            this.masterGain.toDestination();
            return true;
        }
        return false;
    }
    
    async startTestToneWithOffset(offset) {
        await this.startAudioContext();
        if (this.testTone.state !== "started") {
            // Apply the offset to baseline volume
            const testVolume = this.baselineVolume + offset;
            this.effects.volume.volume.value = testVolume;
            
            this.testTone.start();
            this.testTone.connect(this.effects.volume);
            this.effects.volume.connect(this.masterGain);
            this.masterGain.gain.value = 1; // Ensure master gain is at full
            this.masterGain.toDestination();
            return true;
        }
        return false;
    }

    stopTestTone() {
        if (this.testTone.state === "started") {
            this.testTone.stop();
            // Restore the baseline volume after testing
            this.effects.volume.volume.value = this.baselineVolume;
            return true;
        }
        return false;
    }
    
    setEffectParameter(effectName, parameter, value) {
        if (!this.initialized || !this.effects[effectName]) {
            return false;
        }
        
        try {
            const effect = this.effects[effectName];
            
            // Special handling for volume to ensure it works properly
            if (effectName === 'volume' && parameter === 'volume') {
                // Ensure volume is within safe bounds to prevent distortion or clipping
                const safeValue = Math.min(Math.max(value, -60), 12);
                
                // Use rampTo for smoother transitions between volume levels
                // This helps prevent clicks and sudden jumps in audio
                const rampTime = 0.08; // 80ms - fast enough to feel responsive but smooth transitions
                
                // Only use ramp if the change is significant to avoid unnecessary CPU usage
                if (Math.abs(this.effects.volume.volume.value - safeValue) > 0.5) {
                    this.effects.volume.volume.rampTo(safeValue, rampTime);
                } else {
                    this.effects.volume.volume.value = safeValue;
                }
                
                // Log only significant changes to reduce console spam
                if (Math.abs(this.effects.volume.volume.value - safeValue) > 1) {
                    console.log('Setting volume to:', safeValue);
                }
                return true;
            }
            
            // Apply smooth transitions for all parameters to prevent abrupt changes
            const rampTime = 0.1; // 100ms transition time for smooth parameter changes
            
            // Special handling for filter type - must be a string value
            if (effectName === 'filter' && parameter === 'type') {
                // Map numerical value to valid filter types
                const filterTypes = ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass'];
                const index = Math.min(Math.max(0, Math.floor(value * filterTypes.length)), filterTypes.length - 1);
                effect.type = filterTypes[index];
                return true;
            }
            
            // Handle special cases
            if (parameter === 'wet' && effect.wet) {
                // Ensure wet value stays within 0-1 range
                const safeWetValue = Math.min(Math.max(0, value), 1);
                
                // Use ramps for wet values too
                if (Math.abs(effect.wet.value - safeWetValue) > 0.05) {
                    effect.wet.rampTo(safeWetValue, rampTime);
                } else {
                    effect.wet.value = safeWetValue;
                }
            } else if (effect[parameter] !== undefined) {
                if (typeof effect[parameter] === 'object' && effect[parameter].value !== undefined) {
                    // Check if parameter has a rampTo method and use it for smooth transitions
                    if (typeof effect[parameter].rampTo === 'function') {
                        effect[parameter].rampTo(value, rampTime);
                    } else {
                        effect[parameter].value = value;
                    }
                } else {
                    effect[parameter] = value;
                }
            } else {
                console.warn(`Parameter ${parameter} not found on effect ${effectName}`);
                return false;
            }
            
            // Update effects chain if wet parameter changed
            if (parameter === 'wet') {
                this.updateEffectsChain();
            }
            
            return true;
        } catch (e) {
            console.error(`Error setting ${parameter} on ${effectName}:`, e);
            return false;
        }
    }
    
    getActiveEffects() {
        const active = {};
        
        for (const key in this.effects) {
            if (this.effects[key].wet && this.effects[key].wet.value > 0) {
                active[key] = true;
            } else if (key === 'filter' || key === 'compressor' || key === 'eq' || key === 'panner') {
                // Always include these effects in the active list
                active[key] = true;
            }
        }
        
        return active;
    }
    
    setBaselineVolume(value) {
        // Ensure baseline volume is set and stored as the single source of truth
        this.baselineVolume = parseInt(value);
        
        // Apply the volume change immediately for testing
        if (this.testTone && this.testTone.state === "started") {
            // If test tone is playing, update its volume directly
            this.effects.volume.volume.value = value;
        } else {
            // Otherwise just store the value for hand-controlled mapping
            // Volume will be applied by the mapper on next hand update
        }
        
        // Make sure master gain is at full to hear the volume change
        this.masterGain.gain.value = 1;
        
        console.log('Baseline volume set to:', value);
    }

    setDryWet(value) {
        // value expected 0..1
        this.dryWet = Math.max(0, Math.min(1, value));
        if (this.crossFade) {
            this.crossFade.fade.value = this.dryWet;
        }
    }
    
    fadeOutAll() {
        // Clear any existing fade timer
        if (this.fadeTimer) {
            clearTimeout(this.fadeTimer);
        }
        
        // Start a new fade-out over 2 seconds
        const currentVolume = this.masterGain.gain.value;
        this.masterGain.gain.rampTo(0, 2);
        
        // Set a timer to restore volume when hand is detected again
        this.fadeTimer = setTimeout(() => {
            // Stop all sources if we've completely faded out
            if (this.playing && this.sourceType !== 'mic') {
                this.stop();
            }
        }, 2000);
    }
    
    fadeInAll() {
        // If we're faded out, fade back in
        if (this.masterGain.gain.value < 1) {
            this.masterGain.gain.rampTo(1, 0.5);
        }
        
        // Clear any fade-out timer
        if (this.fadeTimer) {
            clearTimeout(this.fadeTimer);
            this.fadeTimer = null;
        }
    }
    
    dispose() {
        // Clean up all audio nodes
        if (this.sourceNode) this.sourceNode.dispose();
        if (this.outputNode) this.outputNode.dispose();
        if (this.postVolumeGain) this.postVolumeGain.dispose();
        if (this.crossFade) this.crossFade.dispose();
        
        // Clean up sources
        if (this.noise) this.noise.dispose();
        if (this.mic) this.mic.dispose();
        if (this.player) this.player.dispose();
        if (this.testTone) this.testTone.dispose();
        
        // Clean up effects
        for (const key in this.effects) {
            if (this.effects[key]) this.effects[key].dispose();
        }
        
        this.initialized = false;
    }
    
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            
            reader.onerror = (error) => {
                reject(error);
            };
            
            reader.readAsArrayBuffer(file);
        });
    }
}

export default AudioEngine;