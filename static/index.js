const MADNESS_COUNT = 8;

const convertFromGoDuration = d => d / 1000000;
const convertFromGoDate = d => new Date(d);
const countdownData = window.countdownInfo;

const countdownContainer = document.querySelector(".countdown-container")
const infoContainer = document.querySelector(".info-container")
const infoTextContainer = document.querySelector(".info-container .info-text")
const infoQrContainer = document.querySelector(".info-container .info-qr")
const infoTitle = document.querySelector(".info-title")
const infoSubtitle = document.querySelector(".info-subtitle")
const infoQrCode = document.querySelector(".qr-code")

const time = document.querySelector(".clock .time-container .time")
const temp = document.querySelector(".clock .time-container .weather")
const unit = document.querySelector(".clock .time-container .weather-unit")
const date = document.querySelector(".clock .date")
const countdown = document.querySelector(".countdown .timer")
const countdownDesc = document.querySelector(".countdown .desc")

const madnessContainer = document.querySelector(".madness-container")
const madnessList1 = document.querySelector(".madness-list-1")
const madnessList2 = document.querySelector(".madness-list-2")
const waitingForResults = document.querySelector(".waiting-for-results")

const destTime = convertFromGoDate(countdownData.countdownTo)

const observationUrl = "https://api.weather.gov/stations/KITH/observations/latest"


const getTemp = data => {
	const value = data.properties.temperature.value
	const unit = data.properties.temperature.unitCode

	if (unit == "wmoUnit:degC" || unit == "wmoUnit:Cel") {
		// the wmo has two units that represent Celsius, "degree Celsius" and "degrees Celsius." I don't know what the difference is
		return { temp: Math.round(value * (9 / 5) + 32), unit: "F" }
	}

	return { temp: Math.round(value), unit: "F" }
}

const calculateTimeUntil = (from, to) => {
	const distance = to.getTime() - (from.getTime());

	const days = Math.floor(distance / (1000 * 60 * 60 * 24));
	const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
	const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
	const seconds = Math.floor((distance % (1000 * 60)) / 1000);
	const elapsed = distance < 0;

	return { elapsed, days, hours, minutes, seconds };
}


// tick is a function that runs every half second. It updates the clock on the page.
const tick = () => {
	const now = new Date();
	const timeText = now.toLocaleTimeString()
	const dateText = now.toLocaleDateString("en-US", { dateStyle: "full" })

	time.textContent = timeText
	date.textContent = dateText

	const distance = calculateTimeUntil(now, destTime)

	if (!distance.elapsed) {
		countdown.textContent = `T-${distance.days}d ${distance.hours}h ${distance.minutes}m ${distance.seconds}s`
		countdownDesc.textContent = countdownData.event
	} else if (window.countdownInfo.message.header != "bracket") {
		countdownContainer.classList.add("hidden")
		infoContainer.classList.remove("hidden")
		infoContainer.classList.add("double")
		if (!countdownData.showMessage) {
			infoContainer.style.backgroundImage = "url(/static/allteam.jpg)"
			infoSubtitle.classList.add("hidden")
			infoTitle.classList.add("hidden")
		}
	}
}

if (countdownData.showMessage && window.countdownInfo.message.header != "bracket") {
	infoTitle.textContent = countdownData.message.header
	if (countdownData.message.body && countdownData.message.body != "__confetti__") {
		infoSubtitle.textContent = countdownData.message.body
	} else {
		infoSubtitle.classList.add("hidden")
	}

	if (countdownData.message.backgroundImage) {
		infoContainer.style.backgroundImage = `url(${countdownData.message.backgroundImage})`
	}

	if (countdownData.message.showQrCode) {
		infoQrCode.setAttribute("src", countdownData.message.qrCodeImage)
		infoQrContainer.classList.remove("hidden")
	}

	countdownContainer.classList.remove("double")
	infoContainer.classList.remove("hidden")
}

setInterval(tick, 500)
setTimeout(() => window.location.reload(), countdownData.refreshFreq)

fetch(observationUrl).then(resp => resp.json()).then(data => {
	const tempData = getTemp(data)
	temp.textContent = tempData.temp
	unit.textContent = tempData.unit
}).catch(error => console.error("error fetching weather", error))

if (window.countdownInfo.message.header == "bracket") {
	infoContainer.classList.add("hidden")

	let bracketInfo = JSON.parse(countdownData.message.body);
	let year = bracketInfo.year;
	let groupId = bracketInfo.groupId;

	madnessList2.setAttribute("start", MADNESS_COUNT / 2 + 1)

	fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-${year}/groups/${groupId}`).then(resp => resp.json()).then(data => {
		if (data.entries[0] && data.entries[0].score.overallScore == 0) {
			waitingForResults.classList.remove("hidden");
			return
		}
		let bracketData = data.entries.map((val, i) => `${val.name} (${val.score.overallScore})`)
		for (let i = 0; i < Math.min(MADNESS_COUNT, bracketData.length); i++) {
			bracketItem = document.createElement("li");
			bracketItem.textContent = bracketData[i];
			(i < MADNESS_COUNT / 2 ? madnessList1 : madnessList2).appendChild(bracketItem)
		}
	})

	madnessContainer.classList.remove("hidden")
}

if (countdownData.showMessage && window.countdownInfo.message.body == "__confetti__") {
	console.log("loading confetti")

	tsParticles.load("tsparticles", {
		"fullScreen": {
			"zIndex": 1
		},
		"particles": {
			"color": {
				"value": [
					"#FFFFFF",
					"#FFd700"
				]
			},
			"move": {
				"direction": "bottom",
				"enable": true,
				"outModes": {
					"default": "out"
				},
				"size": true,
				"speed": {
					"min": 1,
					"max": 3
				}
			},
			"number": {
				"value": 500,
				"density": {
					"enable": true,
					"area": 800
				}
			},
			"opacity": {
				"value": 1,
				"animation": {
					"enable": false,
					"startValue": "max",
					"destroy": "min",
					"speed": 0.3,
					"sync": true
				}
			},
			"rotate": {
				"value": {
					"min": 0,
					"max": 360
				},
				"direction": "random",
				"move": true,
				"animation": {
					"enable": true,
					"speed": 60
				}
			},
			"tilt": {
				"direction": "random",
				"enable": true,
				"move": true,
				"value": {
					"min": 0,
					"max": 360
				},
				"animation": {
					"enable": true,
					"speed": 60
				}
			},
			"shape": {
				"type": [
					"circle",
					"square"
				],
				"options": {}
			},
			"size": {
				"value": {
					"min": 2,
					"max": 4
				}
			},
			"roll": {
				"darken": {
					"enable": true,
					"value": 30
				},
				"enlighten": {
					"enable": true,
					"value": 30
				},
				"enable": true,
				"speed": {
					"min": 15,
					"max": 25
				}
			},
			"wobble": {
				"distance": 30,
				"enable": true,
				"move": true,
				"speed": {
					"min": -15,
					"max": 15
				}
			}
		}
	});
}