use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ServiceConfig {
    pub host: IpAddr,
    pub port: u16,
    pub database_path: PathBuf,
    pub admin_secret: String,
}

impl ServiceConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let host = std::env::var("AGENTPARTY_HOST")
            .ok()
            .map(|value| value.parse())
            .transpose()?
            .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));

        let port = std::env::var("AGENTPARTY_PORT")
            .ok()
            .map(|value| value.parse())
            .transpose()?
            .unwrap_or(4180);

        let database_path = std::env::var_os("AGENTPARTY_DATABASE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("data").join("agentparty-main.sqlite3"));
        let admin_secret = match std::env::var("AGENTPARTY_ADMIN_SECRET") {
            Ok(value) => value,
            Err(_) if host.is_loopback() => "agentparty-dev-admin-secret".to_string(),
            Err(_) => {
                anyhow::bail!("AGENTPARTY_ADMIN_SECRET is required when binding outside localhost")
            }
        };

        Ok(Self {
            host,
            port,
            database_path,
            admin_secret,
        })
    }

    pub fn socket_addr(&self) -> SocketAddr {
        SocketAddr::new(self.host, self.port)
    }
}
