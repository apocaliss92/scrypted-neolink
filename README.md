# Neolink Plugin for Scrypted

Configuration example for battery cams
bind = "0.0.0.0"

[mqtt]
broker_addr = "IP"
port = 1883
credentials = ["<MqttUsername>", "<MqttPassword>"]

[[cameras]]
name = "CameraName"
username = "User"
password = "Pass"
// Sohuld not be required if local discovery
uid = "UUID"
address = "IP"
push_notifications = false
discovery = "local"
idle_disconnect = true
buffer_duration = 500
[cameras.pause]
on_client = true
[cameras.mqtt]
enable_motion = false
enable_light = false
enable_battery = true
enable_preview = true
battery_update = 20000
preview_update = 30000 