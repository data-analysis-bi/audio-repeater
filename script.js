const dropArea    = document.getElementById('dropArea');
const fileInput   = document.getElementById('audioFile');
const fileNameEl  = document.getElementById('fileName');
const status      = document.getElementById('status');
const download    = document.getElementById('download');
const previewSec  = document.getElementById('previewSection');
const audioPrev   = document.getElementById('audioPreview');
const durationInfo = document.getElementById('durationInfo');
const processBtn  = document.getElementById('processButton');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

let selectedSpeed = 1;

// Drag & drop code (unchanged - keep your existing drag handlers here)

// Speed selection
document.querySelectorAll('input[name="speed"]').forEach(radio => {
    radio.addEventListener('change', e => selectedSpeed = parseFloat(e.target.value));
});

processBtn.addEventListener('click', processAudio);

async function processAudio() {
    const file = fileInput.files[0];
    const repeatsInput = document.getElementById('repeats');
    const repeats = parseInt(repeatsInput.value);

    if (!file) return alert('Please select an audio file first.');
    if (isNaN(repeats) || repeats < 1) return alert('Enter a valid number of repeats (≥ 1).');

    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    download.style.display = 'none';
    previewSec.style.display = 'none';
    status.textContent = 'Loading file...';
    status.className = 'processing';

    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Decoding...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        if (!originalBuffer || originalBuffer.length === 0 || isNaN(originalBuffer.length)) {
            throw new Error('Audio file is empty or invalid after decoding');
        }

        let workingBuffer = originalBuffer;

        // Speed change with validation
        if (selectedSpeed !== 1 && selectedSpeed > 0 && isFinite(selectedSpeed)) {
            status.textContent = `Adjusting speed to ${selectedSpeed}×...`;
            progressText.textContent = 'Processing speed...';

            const newLength = Math.max(1, Math.floor(originalBuffer.length / selectedSpeed));

            if (newLength < 1 || isNaN(newLength)) {
                console.warn('Invalid new length calculated - falling back to original');
                status.textContent += ' (speed adjustment skipped)';
            } else {
                const speedCtx = new OfflineAudioContext(
                    originalBuffer.numberOfChannels,
                    newLength,
                    originalBuffer.sampleRate
                );

                const src = speedCtx.createBufferSource();
                src.buffer = originalBuffer;
                src.playbackRate.value = selectedSpeed;
                src.connect(speedCtx.destination);
                src.start(0);

                workingBuffer = await speedCtx.startRendering();

                if (!workingBuffer || workingBuffer.length === 0) {
                    throw new Error('Speed adjustment produced empty buffer');
                }
            }
        }

        // Repeat
        status.textContent = `Repeating ${repeats} times...`;
        progressText.textContent = 'Combining repeats...';

        const finalLength = workingBuffer.length * repeats;
        if (finalLength > 1e8 || isNaN(finalLength)) {  // rough safety limit
            if (!confirm('Very large output expected. Continue anyway?')) {
                resetUI();
                return;
            }
        }

        const finalBuffer = audioCtx.createBuffer(
            workingBuffer.numberOfChannels,
            finalLength,
            workingBuffer.sampleRate
        );

        let progress = 0;
        for (let r = 0; r < repeats; r++) {
            for (let ch = 0; ch < workingBuffer.numberOfChannels; ch++) {
                finalBuffer.copyToChannel(
                    workingBuffer.getChannelData(ch),
                    ch,
                    r * workingBuffer.length
                );
            }
            progress = ((r + 1) / repeats) * 100;
            progressFill.style.width = progress + '%';
            await new Promise(r => setTimeout(r, 0)); // yield for UI
        }

        progressFill.style.width = '100%';
        progressText.textContent = 'Creating file...';

        const wavBlob = audioBufferToWav(finalBuffer);
        const url = URL.createObjectURL(wavBlob);

        audioPrev.src = url;
        previewSec.style.display = 'block';

        const dur = finalBuffer.duration;
        durationInfo.textContent = `Duration: ${Math.floor(dur / 60)} min ${Math.round(dur % 60)} sec`;

        download.href = url;
        download.download = 'processed_audio.wav';
        download.style.display = 'block';

        status.textContent = `Done! (${selectedSpeed}× speed, ${repeats}× repeat)`;
        status.className = 'success';

    } catch (err) {
        console.error('Audio processing error:', err);
        status.textContent = 'Error: ' + (err.message || 'Processing failed');
        status.className = 'error';
        progressText.textContent = 'Failed';
        alert('Error: ' + (err.message || 'Invalid or corrupt audio file. Try another file.'));
    } finally {
        processBtn.disabled = false;
        processBtn.textContent = 'Process Audio';
        setTimeout(() => progressContainer.style.display = 'none', 2500);
    }
}

function resetUI() {
    processBtn.disabled = false;
    processBtn.textContent = 'Process Audio';
    progressContainer.style.display = 'none';
    status.textContent = '';
    status.className = '';
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * numChannels * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, buffer.length * numChannels * 2, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}
