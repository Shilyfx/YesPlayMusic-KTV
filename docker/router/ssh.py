"""Router deployment transport. Password is read only from the environment."""
import argparse
import os
import sys
import paramiko


class RouterHostKey(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        expected = os.environ.get('LUMASING_ROUTER_FINGERPRINT')
        if not expected or key.get_fingerprint().hex() != expected:
            raise RuntimeError('Router host key does not match the verified fingerprint')


parser = argparse.ArgumentParser()
parser.add_argument('--command')
parser.add_argument('--upload', nargs=2, metavar=('LOCAL', 'REMOTE'))
args = parser.parse_args()
client = paramiko.SSHClient()
client.set_missing_host_key_policy(RouterHostKey())
try:
    client.connect(os.environ.get('LUMASING_ROUTER_HOST', '192.168.100.1'),
                   username='root', password=os.environ['LUMASING_ROUTER_PASSWORD'],
                   timeout=15, look_for_keys=False, allow_agent=False)
    if args.upload:
        with client.open_sftp() as sftp:
            sftp.put(*args.upload)
    if args.command:
        channel = client.get_transport().open_session()
        channel.set_combine_stderr(True)
        channel.exec_command(args.command)
        while True:
            chunk = channel.recv(8192)
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
        sys.exit(channel.recv_exit_status())
finally:
    client.close()
