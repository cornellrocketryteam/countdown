package main

import (
	"database/sql"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gorilla/mux"
	_ "github.com/joho/godotenv/autoload"
)

var home = template.Must(template.ParseFiles("index.html"))

type message struct {
	Header          string `json:"header"`
	Body            string `json:"body"`
	BackgroundImage string `json:"backgroundImage"`
}

type countdownInfo struct {
	PageGen        time.Time `json:"generatedAt"`
	CountdownTo    time.Time `json:"countdownTo"`
	RefreshFreq    int       `json:"refreshFreq"`
	Event          string    `json:"event"`
	ShowMessage    bool      `json:"showMessage"`
	SpecialMessage string    `json:"specialMessage"`
	Message        message   `json:"message"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("mysql", os.Getenv("DSN"))
	if err != nil {
		panic(err)
	}

	r := mux.NewRouter()
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("./static/"))))
	r.HandleFunc("/", index).Methods("GET")
	fmt.Println("Serving at :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}

func index(w http.ResponseWriter, r *http.Request) {
	var countdownTo, event, bdName string
	var refreshFreq int
	err := db.QueryRow("SELECT countdownTo, refreshFreq, event FROM events WHERE active = 1").Scan(&countdownTo, &refreshFreq, &event)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	countdownTime, err := time.Parse(time.RFC3339, countdownTo)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	showMessage := false
	header := ""
	body := ""
	img := ""

	msgErr := db.QueryRow("SELECT header, body, img FROM messages WHERE active = 1").Scan(&header, &body, &img)
	if msgErr != nil {
		// now we can setup a birthday message, if one exists
		newyork, _ := time.LoadLocation("America/New_York")
		bdErr := db.QueryRow("SELECT fname FROM birthdays WHERE birthday = ?", time.Now().In(newyork).Format("01-02")).Scan(&bdName)
		if bdErr == nil {
			header = "Happy birthday " + bdName + "!"
			showMessage = true
			img = "static/birthday.jpg"
		}
	} else {
		showMessage = true
	}

	home.Execute(w,
		countdownInfo{
			PageGen:     time.Now(),
			CountdownTo: countdownTime,
			RefreshFreq: refreshFreq,
			Event:       event,
			ShowMessage: showMessage,
			Message: message{
				Header:          header,
				Body:            body,
				BackgroundImage: img,
			},
		},
	)
}
