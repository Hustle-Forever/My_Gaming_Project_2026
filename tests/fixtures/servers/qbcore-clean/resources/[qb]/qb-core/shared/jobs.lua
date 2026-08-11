QBShared = QBShared or {}
QBShared.Jobs = {
    police = {
        label = 'Law Enforcement',
        defaultDuty = true,
        grades = {
            ['0'] = { name = 'Recruit', payment = 50 },
            ['1'] = { name = 'Officer', payment = 75 },
            ['2'] = { name = 'Sergeant', payment = 100 },
            ['3'] = { name = 'Chief', isboss = true, payment = 150 },
        },
    },
    ambulance = {
        label = 'EMS',
        defaultDuty = true,
        grades = {
            ['0'] = { name = 'Trainee', payment = 50 },
            ['1'] = { name = 'Paramedic', payment = 90 },
        },
    },
    mechanic = {
        label = 'Mechanic',
        defaultDuty = false,
        grades = {
            ['0'] = { name = 'Apprentice', payment = 40 },
            ['1'] = { name = 'Boss', isboss = true, payment = 80 },
        },
    },
}
