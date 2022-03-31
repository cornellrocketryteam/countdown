const convertFromGoDuration = d => d / 1000000;
const convertFromGoDate = d => new Date(d);
const countdownData = window.countdownInfo;

const time = document.querySelector(".clock .time-container .time")
const temp = document.querySelector(".clock .time-container .weather")
const unit = document.querySelector(".clock .time-container .weather-unit")
const date = document.querySelector(".clock .date")
const countdown = document.querySelector(".countdown .timer")
const countdownDesc = document.querySelector(".countdown .desc")

const destTime = convertFromGoDate(countdownData.countdownTo)

const weatherLoc = "https://api.weather.gov/gridpoints/BGM/44,69/forecast"

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
	} else {
		countdown.textContent = "Cornell Rocketry Team"
		countdownDesc.textContent = ""
	}
}

if (countdownData.showMessage) {
	const countdownContainer = document.querySelector(".countdown-container")
	const infoContainer = document.querySelector(".info-container")
	const infoTitle = document.querySelector(".info-title")
	const infoSubtitle = document.querySelector(".info-subtitle")

	infoTitle.textContent = countdownData.message.header
	if (countdownData.message.body) {
		infoSubtitle.textContent = countdownData.message.body
	} else {
		infoSubtitle.classList.add("hidden")
	}

	countdownContainer.classList.remove("double")
	infoContainer.classList.remove("hidden")

	if (countdownData.message.backgroundImage) {
		infoContainer.style.backgroundImage = `url(${countdownData.message.backgroundImage})`
	}
}

setInterval(tick, 500)
setTimeout(window.location.reload, countdownData.refreshFreq)

fetch(weatherLoc).then(resp => resp.json()).then(data => {
	temp.textContent = data.properties.periods[0].temperature
	unit.textContent = data.properties.periods[0].temperatureUnit
}).catch(error => console.error("error fetching weather", error))