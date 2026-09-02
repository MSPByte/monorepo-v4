use std::io;
use std::path::Path;
use tokio::io::BufReader;
use crate::framing::{read_envelope, write_envelope};
use crate::messages::Envelope;

/// Send one request envelope and receive one response envelope.
/// Opens a new connection per call (simplest pattern for the UI client).
pub async fn request(socket_path: &Path, envelope: &Envelope) -> io::Result<Envelope> {
    #[cfg(unix)]
    {
        use tokio::net::UnixStream;
        let stream = UnixStream::connect(socket_path).await?;
        let (reader_half, mut writer_half) = tokio::io::split(stream);
        let mut reader = BufReader::new(reader_half);
        write_envelope(&mut writer_half, envelope).await?;
        read_envelope(&mut reader)
            .await?
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "core closed connection"))
    }

    #[cfg(windows)]
    {
        // Named pipe path is the socket_path converted to a string; callers pass
        // the canonical pipe path like r"\\.\pipe\MSPAgent".
        use tokio::net::windows::named_pipe::ClientOptions;
        let client = ClientOptions::new().open(socket_path)?;
        let (reader_half, mut writer_half) = tokio::io::split(client);
        let mut reader = BufReader::new(reader_half);
        write_envelope(&mut writer_half, envelope).await?;
        read_envelope(&mut reader)
            .await?
            .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "core closed connection"))
    }
}

/// Bind and listen for incoming connections. Used by agent-core.
pub struct IpcListener {
    #[cfg(unix)]
    inner: tokio::net::UnixListener,
    #[cfg(windows)]
    socket_path: std::path::PathBuf,
}

/// An accepted connection from a client. Call `handle` to process one
/// request-response cycle.
pub struct IpcConnection {
    #[cfg(unix)]
    stream: tokio::net::UnixStream,
    #[cfg(windows)]
    stream: tokio::net::windows::named_pipe::NamedPipeServer,
}

impl IpcListener {
    pub fn bind(socket_path: &Path) -> io::Result<Self> {
        #[cfg(unix)]
        {
            // Remove stale socket file from a previous run.
            if socket_path.exists() {
                std::fs::remove_file(socket_path)?;
            }
            // Ensure parent directory exists.
            if let Some(parent) = socket_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let listener = tokio::net::UnixListener::bind(socket_path)?;
            // Allow all local users to connect.
            std::fs::set_permissions(
                socket_path,
                std::os::unix::fs::PermissionsExt::from_mode(0o666),
            )?;
            Ok(IpcListener { inner: listener })
        }

        #[cfg(windows)]
        {
            Ok(IpcListener { socket_path: socket_path.to_path_buf() })
        }
    }

    pub async fn accept(&self) -> io::Result<IpcConnection> {
        #[cfg(unix)]
        {
            let (stream, _addr) = self.inner.accept().await?;
            Ok(IpcConnection { stream })
        }

        #[cfg(windows)]
        {
            use tokio::net::windows::named_pipe::ServerOptions;
            let server = ServerOptions::new()
                .first_pipe_instance(false)
                .create(&self.socket_path)?;
            server.connect().await?;
            Ok(IpcConnection { stream: server })
        }
    }
}

impl IpcConnection {
    /// Read one request envelope and call `handler`, then write the returned
    /// response envelope. The connection is closed after one round-trip.
    pub async fn handle<F, Fut>(self, handler: F) -> io::Result<()>
    where
        F: FnOnce(Envelope) -> Fut,
        Fut: std::future::Future<Output = Envelope>,
    {
        #[cfg(unix)]
        let (reader_half, mut writer_half) = tokio::io::split(self.stream);
        #[cfg(windows)]
        let (reader_half, mut writer_half) = tokio::io::split(self.stream);

        let mut reader = BufReader::new(reader_half);
        if let Some(req) = read_envelope(&mut reader).await? {
            let resp = handler(req).await;
            write_envelope(&mut writer_half, &resp).await?;
        }
        Ok(())
    }
}
