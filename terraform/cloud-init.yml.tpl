#cloud-config
package_update: false
package_upgrade: false

write_files:
  - path: /opt/trek/bootstrap.sh
    permissions: "0755"
    content: |
      ${indent(6, bootstrap_script)}

runcmd:
  - /opt/trek/bootstrap.sh > /var/log/trek-bootstrap.log 2>&1

final_message: "TREK bootstrap launched."
