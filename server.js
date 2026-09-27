const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let activeStreamProcess = null;

// Telegram වෙත ලයිව් එක පටන් ගන්න රූට් එක
app.post('/start-live', (req, res) => {
    if (activeStreamProcess) {
        return res.status(400).send('A stream is already running! Stop it first.');
    }

    // Fancode ක්‍රිකට් මැච් M3U8 ලින්ක් එක
    const streamUrl = "https://in-mc-flive.fancode.com/mumbai/4249779_english_hls_5b5f2be03a98278_1ta-di_h264/1080p.m3u8?hdntl=Expires=1790581085~_GO=Generated~acl=/mumbai/4249779_english_hls_5b5f2be03a98278_1ta-di_h264/*~Signature=AUh_zpXFFvBB8PuYQyTwqkTbh5t9O99Uz2sf4GLwTO5cw_FC4K23xHq_UDqNKAUSqVOmXusOwFRDws5oXvKk6aY-YtcN";
    
    // Telegram RTMP URL සහ Stream Key එක
    const customRtmpUrl = "rtmps://dc5-1.rtmp.t.me/s/5354366305:dpVgaYMrS29jhGd-KrvepQ";

    console.log('Starting Original Fancode Live Stream:', streamUrl);

    function startStream() {
        if (activeStreamProcess) {
            try { activeStreamProcess.kill('SIGKILL'); } catch(e) {}
            activeStreamProcess = null;
        }

        const command = ffmpeg(streamUrl)
            .inputOptions([
                '-re',
                '-reconnect 1',
                '-reconnect_streamed 1',
                '-reconnect_delay_max 5',
                '-fflags +discardcorrupt+genpts+nobuffer',
                '-probesize 50M',
                '-analyzeduration 20M',
                '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '-headers', 'Referer: https://fancode.com/\r\nOrigin: https://fancode.com\r\n'
            ])
            .outputOptions([
                // කිසිදු වීඩියෝ/සවුන්ඩ් ෆිල්ටර් එකක් නැත (Original Stream Copy)
                '-threads', '4',               
                '-c:v', 'copy',                // මුල් වීඩියෝ කොالිටි එක එෙම්ම ලබාදෙයි (re-encode වීම වළක්වයි)
                '-c:a', 'copy',                // මුල් ශබ්දය (Original Audio) කිසිදු වෙනසකින් තොරව ලබාදෙයි
                '-max_muxing_queue_size', '9999',
                '-f', 'flv'
            ])
            .output(customRtmpUrl)
            .on('start', (commandLine) => {
                console.log('Original FFmpeg Stream spawned:', commandLine);
            })
            .on('error', (err) => {
                console.error('Streaming error encountered:', err.message);
                if (activeStreamProcess) {
                    setTimeout(() => {
                        console.log('Attempting to restart stream after error...');
                        startStream();
                    }, 3000);
                }
            })
            .on('end', () => {
                console.log('Streaming finished. Restarting automatically...');
                if (activeStreamProcess) {
                    setTimeout(() => {
                        startStream();
                    }, 2000);
                }
            });

        command.run();
        activeStreamProcess = command;
    }

    startStream();

    res.send('<h2>Original Fancode Live stream started successfully! 🏏🔥</h2>');
});

// ලයිව් එක නතර කරන්න රූට් එක
app.get('/stop-live', (req, res) => {
    if (activeStreamProcess) {
        activeStreamProcess.kill('SIGKILL');
        activeStreamProcess = null;
        res.send('<h2>Live stream stopped successfully.</h2>');
    } else {
        res.status(400).send('No active stream running.');
    }
});

let activeViewers = 0;
io.on('connection', (socket) => {
    activeViewers++;
    io.emit('updateViewers', activeViewers);
    socket.on('disconnect', () => {
        activeViewers = Math.max(0, activeViewers - 1);
        io.emit('updateViewers', activeViewers);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
