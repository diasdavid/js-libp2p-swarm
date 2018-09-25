# Connections

Libp2p Switch creates stateful connections between peers. This enables connections to be more easily reused and upgraded.

## Lifecycle

### Base Connection
* When no connection exists between peers, a new base connection is created
  * Once established the base connection will be privatized, if needed
  * Once privatized the connection will be encrypted

### Muxed Connection
* If a muxer exists on the switch, the base connection will attempt to upgrade
  * If the upgrade fails and their is no protocol, upgrading stops and the base connection is saved but not yet used
  * If the upgrade fails and their is a protocol, upgrading stops and the base connection is used
  * If the upgrade works, the upgraded connnection is used
    * Future dial requests will use this connection.
    * Future protocol negotiation will use spawned streams from this connection.

### Protocol Handshaking
* If a protocol was provided on the dial request, handshaking will occur
  * If the connection was upgraded (muxed), a new stream is created for the handshake
  * If the connection was not upgraded, the current connection is used for the handshake
  * If the handshake is successful, the resulting connection will be passed back via the dial calls callback.



No Connection -> .dial -> basic connection *base_connection*
Basic connection -> .protect -> private connection *private*
  or Basic Connection -> .encrypt -> encrypted connection *encrypted*
Private Connection -> .encrypt -> encrypted connection *encrypted*
Encrypted Connection -> .upgrade -> upgraded connection *upgraded*
  or Encrypted Connection -> .upgrade <Error> ->
Encrypted Connection -> .shake(protocol) -> Connected _cannot reuse_ *connection*
Upgraded Connection -> .shake(protocol) -> new stream _upraded conn can be used_ *stream*


## Incoming connections
1. Transport.listener gives us a basic connection
2. We privatize the connection, if needed
3. We must handle encyption muxing first
4. We then handle protocol muxing