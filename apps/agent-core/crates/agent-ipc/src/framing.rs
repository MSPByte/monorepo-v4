use std::io;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use crate::messages::Envelope;

/// Read a single newline-delimited JSON envelope from a byte stream.
/// Returns `None` on EOF (clean shutdown).
pub async fn read_envelope<R>(reader: &mut BufReader<R>) -> io::Result<Option<Envelope>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut line = String::new();
    let n = reader.read_line(&mut line).await?;
    if n == 0 {
        return Ok(None);
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let envelope = serde_json::from_str(trimmed)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    Ok(Some(envelope))
}

/// Write a single newline-delimited JSON envelope to a byte stream.
pub async fn write_envelope<W>(writer: &mut W, envelope: &Envelope) -> io::Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    let mut bytes = serde_json::to_vec(envelope)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await
}
