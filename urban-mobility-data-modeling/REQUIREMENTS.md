# ApexRide: Product Engineering Requirements Document (PRD)

## 1. Product Overview
ApexRide is a high-reliability urban on-demand mobility and dispatch platform designed for high-density metropolitan markets (e.g. Lagos, Nairobi, London). The platform matches riders needing immediate point-to-point transportation with nearby vetted commercial drivers operating registered vehicles, calculating dynamic fares based on route distance, duration, and local traffic conditions.

---

## 2. User Personas

| Persona | Role & Core Needs | Key Constraints |
|---|---|---|
| **Rider** | Commuters requesting on-demand rides, tracking driver approach in real-time, paying securely, and rating service quality. | Must never have multiple simultaneous active trips; financial calculations must be deterministic. |
| **Driver** | Commercial operators accepting dispatch offers, navigating to pickup locations, transporting riders safely, and receiving daily payouts. | Must hold verified active license and vehicle inspection; can only service one active ride at a time. |
| **Dispatch & Support Operator** | Platform operations monitoring fleet health, resolving dispute arbitrations, managing cancellations, and auditing fraud. | Requires unforgeable, immutable trip and fare receipt audit trails. |

---

## 3. The Five Core Product Actions

Every database entity, state transition, and API endpoint designed in this system traces back directly to these five critical actions:

### Action 1: Rider Requests a Trip (`POST /api/v1/trips`)
- **Actor:** Rider
- **Trigger:** Rider selects pickup coordinates, destination coordinates, and vehicle tier (Standard, Comfort, XL).
- **Behavior:** Platform validates rider has zero active trips, computes preliminary fare estimate, creates a trip record in `requested` status, and broadcasts dispatch invitations to drivers within a 3km geofence radius.
- **Integrity Requirement:** Database constraint guarantees a rider cannot create or hold two simultaneous active trips.

### Action 2: Driver Accepts Dispatch Offer (`POST /api/v1/trips/:id/accept`)
- **Actor:** Driver
- **Trigger:** Nearby driver receives dispatch push notification and clicks "Accept".
- **Behavior:** Platform atomically transitions trip from `requested` to `driver_assigned`, binds `driverId` and snapshots current driver and vehicle details to the trip row.
- **Integrity Requirement:** Atomic row lock prevents two concurrent drivers from accepting the same dispatch offer.

### Action 3: Driver Arrives & Begins Trip (`POST /api/v1/trips/:id/start`)
- **Actor:** Driver
- **Trigger:** Driver arrives at pickup location, verifies OTP with rider, and taps "Start Trip".
- **Behavior:** Platform verifies proximity (< 50 meters), verifies trip is in `driver_arriving` status, sets `startedAt = NOW()`, and transitions status to `in_progress`.
- **Integrity Requirement:** A trip cannot start without passing through `driver_assigned` and `driver_arriving`.

### Action 4: Driver Completes Trip & Triggers Billing (`POST /api/v1/trips/:id/complete`)
- **Actor:** Driver / System
- **Trigger:** Vehicle arrives at destination; driver selects "End Trip".
- **Behavior:** Platform captures GPS odometer distance and duration, calculates final fare in minor units (kobo/cents), writes an immutable `FareReceipt`, executes payment charge, and transitions trip to `completed`.
- **Integrity Requirement:** `completed` is a strictly terminal state; fare calculation is immutable and snapshot-isolated.

### Action 5: Rider Submits Rating & Review (`POST /api/v1/trips/:id/reviews`)
- **Actor:** Rider
- **Trigger:** Post-trip modal prompts rider to rate 1–5 stars with optional feedback text.
- **Behavior:** System checks trip is in `completed` status, ensures no review already exists for this trip, records review, and recalculates driver rolling average rating asynchronously.
- **Integrity Requirement:** Foreign key and check constraints make it impossible to review an uncompleted, cancelled, or in-progress trip.
