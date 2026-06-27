# On-Premises AI SCADA Scope and Server Specification

## Purpose

This document defines the final on-premises AI addition for the MRS-A SCADA/SMAS scope. The system shall not use cloud AI, Jetson Orin, or external hosted processing. All application, database, SCADA analytics, CCTV smoke/fire detection, forecasting, and event logs shall remain inside the premises network.

## System Architecture

Use one main x86 rack/industrial server for Ampris backend, database, and AI/ML modules. Use separate NVR/NAS storage for CCTV recording.

Main server shall host:

- Ampris backend and APIs
- PostgreSQL/TimescaleDB database
- SCADA historical data and event logs
- YOLOv8s-Fire smoke/fire detection service
- Load forecasting service
- Transformer oil temperature analytics
- Energy anomaly and trip-risk analytics
- Reports, dashboards, and backup jobs

CCTV/NVR storage shall handle:

- Continuous camera recording
- 60 to 90 days video retention
- Alarm-event bookmarked clips
- RTSP streams for AI analytics

## Server Specification

Recommended main server:

| Component | Specification |
| --- | --- |
| CPU | Intel Xeon Silver / Intel i9 / AMD EPYC, minimum 16 cores / 24 threads |
| RAM | 128 GB ECC recommended, 64 GB minimum |
| GPU | NVIDIA RTX 4070 Ti Super 16 GB minimum recommended; NVIDIA L4 24 GB preferred for server-grade deployment |
| OS Disk | 2 x 1 TB NVMe SSD in RAID 1 |
| DB/App Disk | 4 x 2 TB enterprise SSD in RAID 10 |
| Network | 2 x 1GbE minimum, 10GbE recommended |
| Power | Redundant PSU preferred |
| UPS | Online UPS, 60 minutes backup recommended |
| Form Factor | Rack server or industrial server cabinet |

Separate CCTV storage:

| Component | Specification |
| --- | --- |
| NVR/NAS | Dedicated CCTV NVR/NAS |
| Storage | 6 x 12 TB or 8 x 12 TB HDD minimum in RAID 6 |
| Retention | 60 to 90 days, depending on camera bitrate and recording profile |
| Camera Support | ONVIF/RTSP IP cameras |
| Network | Managed PoE switch with CCTV VLAN |

## Operating System and Software

Use Ubuntu Server 24.04 LTS for the main server.

Software stack:

- Docker / Docker Compose for services
- NVIDIA Driver, CUDA, and NVIDIA Container Toolkit
- PostgreSQL with TimescaleDB extension
- Python AI/ML services
- YOLOv8s-Fire exported to ONNX/TensorRT where practical
- XGBoost for load forecasting and transformer temperature modelling
- Isolation Forest for anomaly detection
- REST API, MQTT, or OPC UA gateway for SCADA/Ampris integration as required
- Automated database backup and log retention jobs

Windows Server shall be used only if the Ampris backend has a mandatory Windows/IIS dependency. If Windows is required, the preferred design is Windows VM for Ampris only, with Ubuntu remaining the AI/database host.

## AI/ML Modules

### CCTV Smoke and Fire Detection

Use YOLOv8s-Fire for smoke/fire detection. The model shall run on the on-premises GPU server using local RTSP camera streams.

Operational requirements:

- Process up to 8 CCTV cameras.
- Use 1080p sub-streams where available.
- Run analytics at 5 to 10 FPS per camera unless higher FPS is required during SAT.
- Generate event metadata containing camera ID, location, detection type, confidence, timestamp, snapshot, and clip reference.
- Trigger SCADA alarm, local hooter/siren, visual beacon, event log, and NVR bookmark.
- Use configurable detection zones, confidence threshold, alarm delay, and masking to reduce false alarms.
- Integrate physical smoke/fire detectors through RTU/SCADA digital inputs for critical indoor/enclosed areas.

### Load Forecasting

Use XGBoost regression for day-ahead load forecasting.

Forecast output:

- Feeder-wise next 24-hour load forecast
- Transformer-wise next 24-hour load forecast
- Peak load time prediction
- Overload threshold warning
- Forecast vs actual comparison
- Exportable PDF, Excel, and CSV reports

Input data:

- Historical current, voltage, power, energy, demand, and power factor
- Time-of-day, day-of-week, month, holiday/working-day flags where available
- Outage/interruption history where available

### Transformer Oil Temperature Monitoring

Use actual OTI/RTD/temperature transducer or existing transformer relay output as the primary measurement. AI shall be advisory only.

Use:

- XGBoost regression to estimate expected oil temperature from load and operating conditions.
- Isolation Forest to detect abnormal thermal behavior where labelled fault data is not available.

SCADA dashboard shall show:

- Transformer-wise oil temperature
- Winding temperature where available
- Load current and loading percentage
- Warning and critical alarm status
- Historical thermal trend
- AI thermal anomaly/risk indication

AI alerts shall not bypass transformer protection relays, trip logic, electrical interlocks, or operator confirmation.

### Energy Loss and Fault-Risk Analytics

Use rule-based electrical thresholds plus Isolation Forest anomaly detection.

Analytics shall include:

- Incoming energy vs outgoing feeder energy loss calculation
- Abnormal feeder consumption detection
- Voltage/current imbalance detection
- Repeated alarm/trip pattern detection
- Advisory trip-risk or abnormal-condition indicator

## Network and Cybersecurity

The system shall use network segmentation:

- SCADA VLAN
- CCTV VLAN
- AI/server VLAN
- Office/LAN access VLAN

Security requirements:

- Firewall/security gateway between network zones
- Role-based access control
- Password protection and user authentication
- Event logging for alarms, acknowledgements, and user actions
- No internet dependency for normal operation
- No video, SCADA data, AI model input, alarms, or reports shall leave the premises network
- Offline/manual AI model updates only with owner approval

## Scope Wording

The Firm shall provide an on-premises x86-based AI analytics and application server for Ampris backend, database, SCADA analytics, CCTV smoke/fire detection, load forecasting, transformer oil temperature monitoring, and anomaly detection. The system shall not use cloud-hosted AI or external internet services for normal operation.

The server shall be equipped with suitable CPU, ECC RAM, NVIDIA GPU, RAID storage, redundant power supply, UPS backup, Linux server OS, database, AI runtime, and required licensed/open-source software. CCTV recording shall be stored on a separate NVR/NAS storage system with RAID protection and 60 to 90 days retention.

The CCTV smoke/fire detection system shall use YOLOv8s-Fire or equivalent approved model running fully on-premises. Smoke/fire detection shall generate SCADA alarm, local hooter/siren, visual beacon, NVR bookmark recording, alarm acknowledgement, and timestamped event logging.

The load forecasting module shall forecast feeder-wise and transformer-wise load for the next 24 hours using locally stored historical SCADA data. The transformer oil temperature module shall monitor actual transformer temperature inputs and use AI analytics to identify abnormal temperature rise, cooling inefficiency, overload risk, and deviation from normal thermal behavior.

All AI/ML outputs shall be advisory and shall not replace electrical protection relays, statutory protection systems, safety interlocks, or authorized operator control procedures.

## FAT/SAT Acceptance Tests

Acceptance shall include:

- Verify system runs without internet connectivity.
- Verify Ampris backend and database run on the main server.
- Verify RAID layout and backup jobs.
- Verify up to 8 camera RTSP streams are available to AI service.
- Verify YOLOv8s-Fire smoke/fire detection triggers event metadata.
- Verify physical smoke/fire detector input triggers SCADA alarm, hooter, beacon, and event log.
- Verify NVR recording and alarm clip bookmarking.
- Verify 24-hour load forecast is generated locally from historical SCADA data.
- Verify transformer oil temperature is acquired from OTI/RTD/transducer or relay output.
- Verify warning and critical temperature thresholds.
- Verify AI thermal anomaly alert is advisory and does not operate breaker/protection logic.
- Verify energy loss/anomaly dashboard and reports.
- Verify authorized LAN access only.
- Verify SCADA monitoring continues if AI service is stopped.
- Verify reports export to PDF, Excel, and CSV.

## Assumptions

- Jetson Orin will not be used.
- Up to 8 CCTV cameras will be used for AI smoke/fire detection.
- CCTV retention target is 60 to 90 days.
- One main server with RAID and backup is acceptable.
- AI processing remains fully on-premises.
- Final camera count, camera bitrate, exact storage sizing, and temperature sensor interface will be confirmed during site survey.
