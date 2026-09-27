const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let activeStreamProcess = null;

// මූලික Akamai HLS ලින්ක් එක
const TARGET_STREAM = "https://sonydaimenew.akamaized.net/hls/live/2022317/criclive2709/ENG/std_lrh-800300010.m3u8?hdnea=exp=1790543196~acl=/*~id=62955783839668586974472942213864~hmac=5aaf548e4fd89269c7f41b0f3dcd7aee0c80f6453c72821825c044ea07340578";

// 1. Local Proxy Route එක (403 Error එක නැති කිරීමට VLC User-Agent සහ Headers සමඟ m3u8 ෆෙච් කිරීම)
app.get('/proxy.m3u8', async (req, res) => {
    try {
        const response = await fetch(TARGET_STREAM, {
            headers: {
                'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
                'Referer': 'https://www.sonyliv.com/'
            }
        });
        
        if (!response.ok) {
            return res.status(response.status).send(`Akamai fetch failed: ${response.statusText}`);
        }

        let body = await response.text();
        
        // TS Segment වලටත් අවශ්‍ය නම් පූර්ණ ලින්ක් සකස් කිරීම
        const baseUrl = TARGET_STREAM.substring(0, TARGET_STREAM.lastIndexOf('/') + 1);
        body = body.replace(/^(?!#)(.*\.ts.*)$/gm, (match) => {
            return baseUrl + match.trim();
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(body);
    } catch (err) {
        res.status(500).send("Proxy Error: " + err.message);
    }
});

// 2. Live Stream එක ආරම්භ කිරීමේ API එක
app.post('/start-live', (req, res) => {
    if (activeStreamProcess) {
        return res.status(400).send('A stream is already running! Stop it first.');
    }

    // FFmpeg දැන් ඉල්ලන්නේ අපේම ලෝකල් ප්‍රොක්සි ලින්ක් එකයි (403 එන්නේ නැත)
    const streamUrl = `http://localhost:${PORT}/proxy.m3u8`;
    
    // Telegram RTMP URL සහ Stream Key එක
    const customRtmpUrl = "rtmps://dc5-1.rtmp.t.me/s/5354366305:dpVgaYMrS29jhGd-KrvepQ";

    console.log('Starting Live Stream via Local Proxy & FFmpeg...');

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
                '-probesize 100M',
                '-analyzeduration 50M',
                '-user_agent', 'VLC/3.0.20 LibVLC/3.0.20',
                '-headers', 'Referer: https://www.sonyliv.com/\x0d\x0a'
            ])
            .outputOptions([
                '-threads', '4',               
                '-c:v', 'copy',                // Video එක Re-encode නොකර Copy කිරීම
                '-c:a', 'aac',                 // Audio එක AAC වලට Convert කිරීම (Telegram සඳහා අත්‍යවශ්‍යයි)
                '-b:a', '128k',
                '-max_muxing_queue_size', '9999',
                '-f', 'flv'
            ])
            .output(customRtmpUrl)
            .on('start', (commandLine) => {
                console.log('FFmpeg Stream successfully spawned:', commandLine);
            })
            .on('error', (err) => {
                console.error('Streaming error encountered:', err.message);
                if (activeStreamProcess) {
                    setTimeout(() => {
                        console.log('Attempting to restart stream after error...');
                        startStream();
                    }, 5000);
                }
            })
            .on('end', () => {
                console.log('Streaming finished. Restarting automatically...');
                if (activeStreamProcess) {
                    setTimeout(() => {
                        startStream();
                    }, 3000);
                }
            });

        command.run();
        activeStreamProcess = command;
    }

    startStream();

    res.send('<h2>Live stream started successfully via Local Proxy to Telegram! 🏏🔥</h2>');
});

// 3. Live Stream එක නැවැත්වීමේ API එක
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
