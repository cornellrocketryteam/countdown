package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
	_ "github.com/joho/godotenv/autoload"
	"github.com/skip2/go-qrcode"
)

var home = template.Must(template.ParseFiles("index.html"))

// authToken is the SHA-256 of the config password — stable across restarts,
// but never sent to the browser (only compared against the cookie value).
var authToken = func() string {
	h := sha256.Sum256([]byte("T34MC0RN"))
	return hex.EncodeToString(h[:])
}()

// ---- types ---------------------------------------------------------------

type message struct {
	Header          string `json:"header"`
	Body            string `json:"body"`
	BackgroundImage string `json:"backgroundImage"`
	ShowQrCode      bool   `json:"showQrCode"`
	QrCodeImage     string `json:"qrCodeImage"`
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

// ---- D1 client -----------------------------------------------------------

type d1Client struct {
	accountID  string
	databaseID string
	apiToken   string
	http       *http.Client
}

type d1QueryReq struct {
	SQL    string `json:"sql"`
	Params []any  `json:"params,omitempty"`
}

type d1Result struct {
	Results []map[string]any `json:"results"`
	Success bool             `json:"success"`
}

type d1Response struct {
	Result  []d1Result `json:"result"`
	Success bool       `json:"success"`
	Errors  []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

var errNoRows = fmt.Errorf("no rows returned")

func (c *d1Client) query(sql string, params ...any) ([]map[string]any, error) {
	body, _ := json.Marshal(d1QueryReq{SQL: sql, Params: params})
	url := fmt.Sprintf(
		"https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query",
		c.accountID, c.databaseID,
	)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	var result d1Response
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	if !result.Success {
		if len(result.Errors) > 0 {
			return nil, fmt.Errorf("D1: %s", result.Errors[0].Message)
		}
		return nil, fmt.Errorf("D1 query failed")
	}
	if len(result.Result) == 0 {
		return []map[string]any{}, nil
	}
	return result.Result[0].Results, nil
}

func (c *d1Client) queryRow(sql string, params ...any) (map[string]any, error) {
	rows, err := c.query(sql, params...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errNoRows
	}
	return rows[0], nil
}

func (c *d1Client) execute(sql string, params ...any) error {
	_, err := c.query(sql, params...)
	return err
}

func str(row map[string]any, key string) string {
	if v, ok := row[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func intVal(row map[string]any, key string) int {
	if v, ok := row[key]; ok {
		if f, ok := v.(float64); ok {
			return int(f)
		}
	}
	return 0
}

func joinNames(names []string) string {
	switch len(names) {
	case 1:
		return names[0]
	case 2:
		return names[0] + " & " + names[1]
	default:
		return strings.Join(names[:len(names)-1], ", ") + " & " + names[len(names)-1]
	}
}

var db *d1Client

// ---- JSON helpers --------------------------------------------------------

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ---- Auth ----------------------------------------------------------------

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("cfg_auth")
		if err != nil || cookie.Value != authToken {
			jsonErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func configPageHandler(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "config.html")
}

func configLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password != "T34MC0RN" {
		jsonErr(w, http.StatusUnauthorized, "incorrect password")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "cfg_auth",
		Value:    authToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	jsonOK(w, map[string]bool{"ok": true})
}

func configLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:    "cfg_auth",
		Value:   "",
		Path:    "/",
		MaxAge:  -1,
		Expires: time.Unix(0, 0),
	})
	jsonOK(w, map[string]bool{"ok": true})
}

// ---- Birthday handlers ---------------------------------------------------

func listBirthdays(w http.ResponseWriter, r *http.Request) {
	rows, err := db.query("SELECT id, fname, birthday FROM birthdays ORDER BY birthday")
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	jsonOK(w, rows)
}

func addBirthdayAPI(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Fname    string `json:"fname"`
		Birthday string `json:"birthday"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Fname == "" || body.Birthday == "" {
		jsonErr(w, http.StatusBadRequest, "fname and birthday required")
		return
	}
	if err := db.execute("INSERT INTO birthdays (fname, birthday) VALUES (?, ?)", body.Fname, body.Birthday); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	row, err := db.queryRow(
		"SELECT id, fname, birthday FROM birthdays WHERE fname = ? AND birthday = ? ORDER BY id DESC LIMIT 1",
		body.Fname, body.Birthday,
	)
	if err != nil {
		jsonOK(w, map[string]string{"fname": body.Fname, "birthday": body.Birthday})
		return
	}
	jsonOK(w, row)
}

func updateBirthdayAPI(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	var body struct {
		Fname    string `json:"fname"`
		Birthday string `json:"birthday"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Fname == "" || body.Birthday == "" {
		jsonErr(w, http.StatusBadRequest, "fname and birthday required")
		return
	}
	if err := db.execute("UPDATE birthdays SET fname = ?, birthday = ? WHERE id = ?", body.Fname, body.Birthday, id); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]any{"id": id, "fname": body.Fname, "birthday": body.Birthday})
}

func deleteBirthdayAPI(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	if err := db.execute("DELETE FROM birthdays WHERE id = ?", id); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]bool{"ok": true})
}

// ---- Event handlers ------------------------------------------------------

func listEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := db.query("SELECT id, countdownTo, refreshFreq, event, active FROM events ORDER BY id")
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	jsonOK(w, rows)
}

func addEventAPI(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CountdownTo string `json:"countdownTo"`
		Event       string `json:"event"`
		RefreshFreq int    `json:"refreshFreq"`
		Active      int    `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Event == "" {
		jsonErr(w, http.StatusBadRequest, "event name required")
		return
	}
	if body.RefreshFreq == 0 {
		body.RefreshFreq = 60000
	}
	if err := db.execute(
		"INSERT INTO events (countdownTo, event, refreshFreq, active) VALUES (?, ?, ?, ?)",
		body.CountdownTo, body.Event, body.RefreshFreq, body.Active,
	); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]bool{"ok": true})
}

func updateEventAPI(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	var body struct {
		CountdownTo string `json:"countdownTo"`
		Event       string `json:"event"`
		RefreshFreq int    `json:"refreshFreq"`
		Active      int    `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.RefreshFreq == 0 {
		body.RefreshFreq = 60000
	}
	if err := db.execute(
		"UPDATE events SET countdownTo = ?, event = ?, refreshFreq = ?, active = ? WHERE id = ?",
		body.CountdownTo, body.Event, body.RefreshFreq, body.Active, id,
	); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]bool{"ok": true})
}

func deleteEventAPI(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	if err := db.execute("DELETE FROM events WHERE id = ?", id); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]bool{"ok": true})
}

// ---- Router + main -------------------------------------------------------

func main() {
	db = &d1Client{
		accountID:  os.Getenv("CF_ACCOUNT_ID"),
		databaseID: os.Getenv("CF_DATABASE_ID"),
		apiToken:   os.Getenv("CF_API_TOKEN"),
		http:       &http.Client{Timeout: 10 * time.Second},
	}

	r := mux.NewRouter()
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("./static/"))))
	r.HandleFunc("/", index).Methods("GET")

	r.HandleFunc("/config", configPageHandler).Methods("GET")
	r.HandleFunc("/config/login", configLogin).Methods("POST")
	r.HandleFunc("/config/logout", configLogout).Methods("POST")

	api := r.PathPrefix("/api").Subrouter()
	api.Use(authMiddleware)
	api.HandleFunc("/birthdays", listBirthdays).Methods("GET")
	api.HandleFunc("/birthdays", addBirthdayAPI).Methods("POST")
	api.HandleFunc("/birthdays/{id:[0-9]+}", updateBirthdayAPI).Methods("PUT")
	api.HandleFunc("/birthdays/{id:[0-9]+}", deleteBirthdayAPI).Methods("DELETE")
	api.HandleFunc("/events", listEvents).Methods("GET")
	api.HandleFunc("/events", addEventAPI).Methods("POST")
	api.HandleFunc("/events/{id:[0-9]+}", updateEventAPI).Methods("PUT")
	api.HandleFunc("/events/{id:[0-9]+}", deleteEventAPI).Methods("DELETE")

	fmt.Println("Serving at :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}

// ---- Index handler -------------------------------------------------------

func index(w http.ResponseWriter, r *http.Request) {
	countdownToStr := "2000-01-01T00:00:00Z"
	refreshFreq := 300000
	event := ""

	row, err := db.queryRow("SELECT countdownTo, refreshFreq, event FROM events WHERE active = 1")
	if err == nil {
		countdownToStr = str(row, "countdownTo")
		refreshFreq = intVal(row, "refreshFreq")
		event = str(row, "event")
	} else if err != errNoRows {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	countdownTime, err := time.Parse(time.RFC3339, countdownToStr)
	if err != nil {
		countdownTime, err = time.Parse("2006-01-02T15:04:05", countdownToStr)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("invalid countdownTo: " + countdownToStr))
			return
		}
	}

	showMessage := false
	header := ""
	body := ""
	img := ""
	qrCodeData := ""
	showQrCode := false
	qrCodeImage := ""

	msgRow, msgErr := db.queryRow("SELECT header, body, img, qrCode FROM messages WHERE active = 1")
	if msgErr == nil {
		showMessage = true
		header = str(msgRow, "header")
		body = str(msgRow, "body")
		img = str(msgRow, "img")
		qrCodeData = str(msgRow, "qrCode")
		if qrCodeData != "" {
			showQrCode = true
			png, _ := qrcode.Encode(qrCodeData, qrcode.Medium, 512)
			qrCodeImage = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
		}
	} else {
		newyork, _ := time.LoadLocation("America/New_York")
		bdRows, bdErr := db.query(
			"SELECT fname FROM birthdays WHERE birthday = ?",
			time.Now().In(newyork).Format("01-02"),
		)
		if bdErr == nil && len(bdRows) > 0 {
			names := make([]string, len(bdRows))
			for i, r := range bdRows {
				names[i] = str(r, "fname")
			}
			header = "Happy birthday " + joinNames(names) + "!"
			showMessage = true
			img = "static/birthday.jpg"
		}
	}

	home.Execute(w, countdownInfo{
		PageGen:     time.Now(),
		CountdownTo: countdownTime,
		RefreshFreq: refreshFreq,
		Event:       event,
		ShowMessage: showMessage,
		Message: message{
			Header:          header,
			Body:            body,
			BackgroundImage: img,
			ShowQrCode:      showQrCode,
			QrCodeImage:     qrCodeImage,
		},
	})
}
