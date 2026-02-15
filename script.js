const dropArea    = document.getElementById('dropArea');
const fileInput   = document.getElementById('audioFile');
const fileNameEl  = document.getElementById('fileName');
const status      = document.getElementById('status');
const download    = document.getElementById('download');
const previewSec  = document.getElementById('previewSection');
const audioPrev   = document.getElementById('audioPreview');
const repeatBtn   = document.getElementById('repeatButton');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// Click to open file dialog
dropArea.addEventListener('click', () => fileInput.click());

// Show selected file name
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    fileNameEl.textContent = file ? file.name : '';
});

// Drag & drop handlers
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropArea.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

['dragenter', 'dragover'].forEach(evt => {
    dropArea.addEventListener(evt, () => dropArea.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(evt => {
    dropArea.addEventListener(evt, () => dropArea.classList.remove('dragover'), false);
});

dropArea.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
        fileInput.files = e.dataTransfer.files;
        fileNameEl.textContent = file.name;
    } else {
        alert('Please drop an audio file.');
    }
});

repeatBtn.addEventListener('click', repeatAudio);

async function repeatAudio() {
    const file = fileInput.files[0];
    const repeats = parseInt(document.getElementById('repeats').value);

    if (!file) return alert('Please select an audio file first.');
    if (isNaN(repeats) || repeats < 1) return alert('Please enter a number ≥ 1.');

    repeatBtn.disabled = true;
    download.style.display = 'none';
    previewSec.style.display = 'none';
    status.textContent = 'Starting...';
    status.className = 'processing';

    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Preparing...';

    try {
        status.textContent = 'Decoding audio...';
        progressText.textContent = 'Decoding file...';

        const arrayBuffer = await file.arrayBuffer();
        const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await tempCtx.decodeAudioData(arrayBuffer);

        status.textContent = 'Preparing repeat...';
        progressText.textContent = 'Preparing buffer...';

        const totalSamples = originalBuffer.length * repeats;
        if (totalSamples > 100_000_000) {
            const approxMin = Math.round(totalSamples / originalBuffer.sampleRate / 60);
            if (!confirm(`Large file (~${approxMin} min). May take time or crash tab. Continue?`)) {
                resetUI();
                return;
            }
        }

        const offlineCtx = new OfflineAudioContext(
            originalBuffer.numberOfChannels,
            totalSamples,
            originalBuffer.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.loop = true;
        source.connect(offlineCtx.destination);

        source.start(0);
        source.stop(originalBuffer.duration * repeats);

        status.textContent = 'Rendering repeated audio...';
        progressText.textContent = 'Rendering (this may take a while)...';

        // Fake progress animation
        let progress = 5;
        progressFill.style.width = progress + '%';
        const interval = setInterval(() => {
            if (progress < 92) {
                progress += Math.random() * 6 + 3;
                progress = Math.min(progress, 92);
                progressFill.style.width = progress + '%';
            }
        }, 600);

        const renderedBuffer = await offlineCtx.startRendering();

        clearInterval(interval);
        progressFill.style.width = '100%';
        progressText.textContent = 'Finalizing file...';

        status.textContent = 'Converting to file...';
        const wavBlob = audioBufferToWav(renderedBuffer);
        const url = URL.createObjectURL(wavBlob);

        audioPrev.src = url;
        previewSec.style.display = 'block';

        download.href = url;
        download.download = 'repeated_audio.wav';
        download.style.display = 'block';

        status.textContent = 'Done! Preview or download below ↓';
        status.className = 'success';
        progressText.textContent = 'Complete!';

    } catch (err) {
        console.error('Processing failed:', err);
        status.textContent = 'Error: ' + (err.message || 'Failed to process audio');
        status.className = 'error';
        progressText.textContent = 'Failed – see console (F12) for details';
        alert('Error: ' + (err.message || 'Could not process the file. Try a shorter audio or fewer repeats.'));
    } finally {
        repeatBtn.disabled = false;
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 1800);
    }
}

function resetUI() {
    repeatBtn.disabled = false;
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
