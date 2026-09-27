const express = require('express');
const path = require('path');
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

app.post('/start-live', (req, res) => {
    if (activeStreamProcess) {
        return res.status(400).send('A stream is already running! Stop it first.');
    }

    // VLC එකේ වැඩ කළ නිවැරදිම ලින්ක් එක (Media m3u8 stream + Token)
    const streamUrl = "https://sonydaimenew.akamaized.net/hls/live/2022317/criclive2709/ENG/std_lrh-800300010.m3u8?hdnea=exp=1790543196~acl=/*~id=62955783839668586974472942213864~hmac=5aaf548e4fd89269c7f41b0f3dcd7aee0c80f6453c72821825c044ea07340578";
    
    // Telegram RTMP URL සහ Stream Key එක
    const customRtmpUrl = "rtmps://dc5-1.rtmp.t.me/s/5354366305:dpVgaYMrS29jhGd-KrvepQ";

    console.log('Starting Working ENG vs SL Live Stream via FFmpeg...');

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
                // VLC මඟින් යවන සාමාන්‍ය User-Agent සහ Headers භාවිත කිරීම
                '-user_agent', 'Lavf/60.3.100',
                '-headers', 'Referer: https://www.sonyliv.com/\x0d\x0aOrigin: https://www.sonyliv.com\x0d\x0a'
            ])
            .outputOptions([
                '-threads', '4',               
                '-c:v', 'copy',                // Original Video (No re-encode)
                '-c:a', 'copy',                // Original Audio (No re-encode)
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

    res.send('<h2>ENG vs SL Live stream started successfully via VLC working link! 🏏🔥</h2>');
});

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
