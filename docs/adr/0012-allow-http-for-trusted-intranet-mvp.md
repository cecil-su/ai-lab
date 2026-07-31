# Allow HTTP for trusted intranet MVP deployments

The MVP main service may run over HTTP on a trusted intranet IP address to keep deployment simple. Clients and server configuration must still support HTTPS URLs, and production or broader network deployments should put the service behind an HTTPS reverse proxy. The desktop UI should make HTTP connections visibly distinct because bearer tokens and admin sessions are not protected from local network observers.
